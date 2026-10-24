import hashlib
import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.main import create_app
from app.models import Event, Idempotency, Item, Member, Space
from app.schemas import ItemCreate
from tests.conftest import authenticate, create


def test_simplified_items_preserve_legacy_data_without_exposing_it(environment):
    client, engine, _, _ = environment
    h, space, _ = authenticate(client)
    item = create(client, h, space, name="相机", purchase_amount_cents=12300, note="日常使用")
    retired = {"category", "brand", "model", "location", "channel", "serial", "warranty"}
    with Session(engine) as db, db.begin():
        stored = db.get(Item, item["id"])
        for key in retired:
            setattr(stored, "legacy_" + key, "legacy-only-value")
    path = f"/api/v1/items/{item['id']}"
    for key in retired:
        response = client.patch(path, headers={**h, "If-Match": '"1"'}, json={key: "removed"})
        assert response.status_code == 422
    updated = client.patch(path, headers={**h, "If-Match": '"1"'}, json={"note": "新的备注"})
    assert updated.status_code == 200
    assert updated.json()["created_at"] == item["created_at"]
    assert updated.json()["purchase_amount_cents"] == 12300
    assert not retired & client.get(path, headers=h).json().keys()
    assert not client.get(f"/api/v1/spaces/{space}/items?q=legacy-only-value", headers=h).json()[
        "items"
    ]
    assert len(client.get(f"/api/v1/spaces/{space}/items?q=相机", headers=h).json()["items"]) == 1
    analytics = client.get(f"/api/v1/spaces/{space}/analytics", headers=h).json()
    assert "categories" not in analytics and analytics["known_purchase_cents"] == 12300
    with Session(engine) as db:
        stored = db.get(Item, item["id"])
        assert all(getattr(stored, "legacy_" + key) == "legacy-only-value" for key in retired)
    schema = client.get("/openapi.json").json()
    for name in ("ItemCreate", "ItemPatch", "ItemOut", "DraftValues"):
        assert not retired & schema["components"]["schemas"][name]["properties"].keys()
    params = schema["paths"]["/api/v1/spaces/{space_id}/items"]["get"]["parameters"]
    assert "category" not in {p["name"] for p in params}


def test_pre_upgrade_create_replay_does_not_duplicate_or_expose_retired_fields(environment):
    client, engine, _, _ = environment
    h, space, login = authenticate(client)
    item = create(client, h, space, key="old-create", name="相机", purchase_amount_cents=12300)
    retired = {
        "category": "数码",
        "brand": "旧品牌",
        "model": "旧型号",
        "location": None,
        "channel": None,
        "serial": None,
        "warranty": None,
    }
    old_payload = {
        **ItemCreate(name="相机", purchase_amount_cents=12300).model_dump(mode="json"),
        **retired,
    }
    with Session(engine) as db, db.begin():
        receipt = db.get(Idempotency, (login["user"]["id"], f"create:{space}", "old-create"))
        receipt.response = {**receipt.response, **retired}
        receipt.fingerprint = hashlib.sha256(
            json.dumps(old_payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
    headers = {**h, "Idempotency-Key": "old-create"}
    endpoint = f"/api/v1/spaces/{space}/items"
    replay = client.post(
        endpoint, headers=headers, json={"name": "相机", "purchase_amount_cents": 12300}
    )
    assert replay.status_code == 201 and replay.json() == item
    assert len(client.get(endpoint, headers=h).json()["items"]) == 1
    assert (
        client.post(
            endpoint, headers=headers, json={"name": "另一台相机", "purchase_amount_cents": 12300}
        ).status_code
        == 409
    )


def test_name_only_and_readonly_fields(client):
    h, space, _ = authenticate(client)
    item = create(client, h, space, name="  耳机  ")
    assert item["name"] == "耳机"
    assert item["purchase_amount_cents"] is None
    assert item["purchase_date"] is None
    assert item["metrics"]["current_daily_yuan"] is None
    assert (
        not {"category", "brand", "model", "location", "channel", "serial", "warranty"}
        & item.keys()
    )
    path = f"/api/v1/items/{item['id']}"
    assert client.patch(path, headers=h, json={"name": "a"}).status_code == 428
    assert (
        client.patch(path, headers={**h, "If-Match": '"1"'}, json={"status": "sold"}).status_code
        == 422
    )
    for payload in (
        {"name": None},
        {"name": "  "},
        {"attachment_file_ids": None},
        {"purchase_amount_cents": True},
        {"purchase_amount_cents": -1},
    ):
        assert client.patch(path, headers={**h, "If-Match": '"1"'}, json=payload).status_code == 422
    result = client.patch(path, headers={**h, "If-Match": '"1"'}, json={"note": "备注"}).json()
    assert result["revision"] == 2
    result = client.patch(path, headers={**h, "If-Match": '"2"'}, json={"note": None}).json()
    assert result["note"] is None and result["name"] == "耳机"


def test_cost_expense_disposal_trash_restore(client):
    h, space, _ = authenticate(client)
    item = create(client, h, space, purchase_amount_cents=800000, purchase_date="2025-06-07")
    assert item["metrics"]["holding_days"] == 500
    assert item["metrics"]["current_daily_yuan"] == "16.00"
    path = f"/api/v1/items/{item['id']}"
    expense = {"category": "维修", "amount_cents": 50000, "occurred_on": "2026-10-18"}
    eh = {**h, "If-Match": '"1"', "Idempotency-Key": "expense-1"}
    updated = client.post(path + "/expenses", headers=eh, json=expense)
    assert updated.status_code == 200, updated.text
    item = updated.json()
    assert item["metrics"]["current_daily_yuan"] == "17.00"
    assert len(item["expenses"]) == 1
    assert client.post(path + "/expenses", headers=eh, json=expense).json() == item
    conflict = client.post(path + "/expenses", headers=eh, json={**expense, "amount_cents": 1})
    assert conflict.status_code == 409
    assert (
        client.patch(path, headers={**h, "If-Match": '"1"'}, json={"name": "old"}).status_code
        == 409
    )
    disposed = client.put(
        path + "/disposal",
        headers={**h, "If-Match": '"2"'},
        json={"status": "sold", "disposal_date": "2026-10-19", "recovery_amount_cents": 300000},
    ).json()
    assert disposed["metrics"]["net_cost_cents"] == 550000
    assert disposed["metrics"]["actual_daily_yuan"] == "11.00"
    assert disposed["metrics"]["current_daily_yuan"] is None
    assert client.delete(path, headers={**h, "If-Match": '"3"'}).status_code == 204
    assert client.get(path, headers=h).status_code == 404
    assert client.get(f"/api/v1/spaces/{space}/summary", headers=h).json()["item_count"] == 0
    trash = client.get(f"/api/v1/spaces/{space}/trash", headers=h).json()["items"]
    assert trash[0]["revision"] == 4
    assert client.delete(path, headers={**h, "If-Match": '"4"'}).status_code == 204
    restored = client.post(
        path + "/restore", headers={**h, "If-Match": '"4"', "Idempotency-Key": "restore"}
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["status"] == "sold"
    assert restored.json()["revision"] == 5
    events = client.get(path + "/events", headers=h).json()["items"]
    assert len(events) == 5
    assert sum(e["type"] == "item_deleted" for e in events) == 1


def test_timeline_rollback_and_expense_correction(client):
    h, space, _ = authenticate(client)
    item = create(client, h, space, purchase_date="2026-10-01", purchase_amount_cents=1000)
    path = f"/api/v1/items/{item['id']}"
    body = {"category": "维修", "amount_cents": 100, "occurred_on": "2026-10-10"}
    added = client.post(
        path + "/expenses", headers={**h, "If-Match": '"1"', "Idempotency-Key": "e"}, json=body
    ).json()
    assert (
        client.patch(
            path, headers={**h, "If-Match": '"2"'}, json={"purchase_date": "2026-10-11"}
        ).status_code
        == 422
    )
    assert client.get(path, headers=h).json()["revision"] == 2
    assert (
        client.put(
            path + "/disposal",
            headers={**h, "If-Match": '"2"'},
            json={
                "status": "retired",
                "disposal_date": "2026-10-09",
                "recovery_amount_cents": 0,
                "confirmed_zero": True,
            },
        ).status_code
        == 422
    )
    expense_path = path + "/expenses/" + added["expenses"][0]["id"]
    corrected = client.patch(
        expense_path, headers={**h, "If-Match": '"2"'}, json={"amount_cents": 200}
    ).json()
    assert len(corrected["expenses"]) == 1 and corrected["metrics"]["extra_cents"] == 200
    assert (
        client.put(
            path + "/disposal",
            headers={**h, "If-Match": '"3"'},
            json={"status": "retired", "disposal_date": "2026-10-19", "recovery_amount_cents": 0},
        ).status_code
        == 422
    )


def test_summary_missing_rounding_and_pagination(client):
    h, space, _ = authenticate(client)
    summary_path = f"/api/v1/spaces/{space}/summary"
    assert (
        client.get(summary_path, headers=h).json()["current_daily"]["known_amount_yuan"] == "0.00"
    )
    create(client, h, space, name="未知")
    assert client.get(summary_path, headers=h).json()["current_daily"]["known_amount_yuan"] is None
    create(client, h, space, purchase_amount_cents=800000, purchase_date="2025-06-07")
    create(client, h, space, name="耳机", purchase_amount_cents=300000, purchase_date="2024-10-20")
    summary = client.get(summary_path, headers=h).json()
    assert summary["item_count"] == 3
    assert summary["current_daily"] == {
        "known_amount_yuan": "20.11",
        "holding_count": 3,
        "incomplete_count": 1,
        "complete": False,
    }
    page = client.get(f"/api/v1/spaces/{space}/items?limit=1", headers=h).json()
    seen = {page["items"][0]["id"]}
    while page["next_cursor"]:
        page = client.get(
            f"/api/v1/spaces/{space}/items",
            headers=h,
            params={"limit": 1, "cursor": page["next_cursor"]},
        ).json()
        for item in page["items"]:
            assert item["id"] not in seen
            seen.add(item["id"])
    assert len(seen) == 3
    assert client.get(f"/api/v1/spaces/{space}/items?cursor=bad", headers=h).status_code == 422
    assert client.get(f"/api/v1/spaces/{space}/items?status=idle", headers=h).status_code == 422
    analysis = client.get(f"/api/v1/spaces/{space}/analytics", headers=h).json()
    assert analysis["known_purchase_cents"] == 1100000


def test_unrounded_aggregate(client):
    h, space, _ = authenticate(client)
    for _ in range(2):
        create(client, h, space, purchase_amount_cents=1, purchase_date="2026-10-17")
    summary = client.get(f"/api/v1/spaces/{space}/summary", headers=h).json()
    assert summary["current_daily"]["known_amount_yuan"] == "0.01"


@pytest.mark.parametrize(
    "purchase,recovery,expected", [(0, 100, "-1.00"), (None, 0, None), (100, 0, "1.00")]
)
def test_zero_unknown_negative_and_one_day(client, purchase, recovery, expected):
    h, space, _ = authenticate(client)
    item = create(client, h, space, purchase_amount_cents=purchase, purchase_date="2026-10-19")
    result = client.put(
        f"/api/v1/items/{item['id']}/disposal",
        headers={**h, "If-Match": '"1"'},
        json={
            "status": "sold",
            "disposal_date": "2026-10-19",
            "recovery_amount_cents": recovery,
            "confirmed_zero": True,
        },
    ).json()
    assert result["metrics"]["actual_daily_yuan"] == expected
    assert result["metrics"]["holding_days"] == 1


def test_isolation_and_revocation(environment):
    client, engine, _, _ = environment
    h, space, _ = authenticate(client)
    other, other_space, _ = authenticate(client, "bob")
    item = create(client, h, space, key="creation")
    for path in [
        f"/items/{item['id']}",
        f"/items/{item['id']}/events",
        f"/spaces/{space}/items",
        f"/spaces/{space}/summary",
        f"/spaces/{space}/analytics",
        f"/spaces/{space}/events",
        f"/spaces/{space}/trash",
    ]:
        assert client.get("/api/v1" + path, headers=other).status_code == 404
    with Session(engine) as db, db.begin():
        member = db.scalar(select(Member).where(Member.space_id == space))
        member.role = "viewer"
    assert (
        client.post(
            f"/api/v1/spaces/{space}/items",
            headers={**h, "Idempotency-Key": "creation"},
            json={"name": "电脑"},
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/v1/items/{item['id']}", headers={**h, "If-Match": '"1"'}, json={"name": "a"}
        ).status_code
        == 403
    )
    with Session(engine) as db, db.begin():
        db.delete(db.scalar(select(Member).where(Member.space_id == space)))
    assert client.get(f"/api/v1/items/{item['id']}", headers=h).status_code == 404


def test_refresh_rotation_replay_and_logout(client):
    h, _, tokens = authenticate(client)
    renewed = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert renewed.status_code == 200
    assert (
        client.post(
            "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        ).status_code
        == 401
    )
    assert client.get("/api/v1/me", headers=h).status_code == 401
    assert (
        client.get(
            "/api/v1/me", headers={"Authorization": "Bearer " + renewed.json()["access_token"]}
        ).status_code
        == 401
    )
    h, _, tokens = authenticate(client)
    assert client.post("/api/v1/auth/logout", headers=h).status_code == 204
    assert client.get("/api/v1/me", headers=h).status_code == 401
    assert (
        client.post(
            "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        ).status_code
        == 401
    )


def test_parallel_login_and_creation(environment):
    client, engine, _, _ = environment

    def first_login(_):
        return client.post("/api/v1/auth/dev/login", json={"identity": "parallel"}).json()["user"][
            "id"
        ]

    with ThreadPoolExecutor(max_workers=4) as executor:
        ids = list(executor.map(first_login, range(4)))
    assert len(set(ids)) == 1
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Space)) == 1
    h, space, _ = authenticate(client, "parallel")

    def save(_):
        return create(client, h, space, key="same")["id"]

    with ThreadPoolExecutor(max_workers=4) as executor:
        item_ids = list(executor.map(save, range(4)))
    assert len(set(item_ids)) == 1
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Item)) == 1
        assert db.scalar(select(func.count()).select_from(Event)) == 1


def test_parallel_revisions_and_expense_idempotency(client):
    h, space, _ = authenticate(client)
    item = create(client, h, space)
    path = f"/api/v1/items/{item['id']}"

    def edit(name):
        return client.patch(path, headers={**h, "If-Match": '"1"'}, json={"name": name}).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(edit, ["a", "b"])) == [200, 409]

    def expense(_):
        return client.post(
            path + "/expenses",
            headers={**h, "If-Match": '"2"', "Idempotency-Key": "same"},
            json={"category": "维修", "amount_cents": 100, "occurred_on": "2026-10-18"},
        )

    with ThreadPoolExecutor(max_workers=4) as executor:
        responses = list(executor.map(expense, range(4)))
    assert all(r.status_code == 200 for r in responses)
    assert len(client.get(path, headers=h).json()["expenses"]) == 1


def test_files_pending_ownership_links(environment):
    client, engine, _, storage = environment
    h, space, _ = authenticate(client)
    other, _, _ = authenticate(client, "bob")
    response = client.post(
        "/api/v1/files/uploads",
        headers=h,
        json={
            "space_id": space,
            "purpose": "receipt",
            "name": "receipt.png",
            "mime_type": "image/png",
            "size_bytes": 100,
        },
    )
    assert response.status_code == 201, response.text
    upload = response.json()
    file_id = upload["id"]
    assert upload["method"] == "PUT"
    assert client.get(f"/api/v1/files/{file_id}/access", headers=h).status_code == 404
    assert client.post(f"/api/v1/files/{file_id}/complete", headers=other).status_code == 404
    assert client.post(f"/api/v1/files/{file_id}/complete", headers=h).status_code == 200
    assert client.post(f"/api/v1/files/{file_id}/complete", headers=h).status_code == 200
    assert len(storage.completed) == 1
    create(client, h, space, attachment_file_ids=[file_id])
    assert client.get(f"/api/v1/files/{file_id}/access", headers=h).status_code == 200
    assert client.get(f"/api/v1/files/{file_id}/access", headers=other).status_code == 404
    with Session(engine) as db, db.begin():
        db.delete(db.scalar(select(Member).where(Member.space_id == space)))
    assert client.get(f"/api/v1/files/{file_id}/access", headers=h).status_code == 404


def test_events_pagination_null_date(client):
    h, space, _ = authenticate(client)
    item = create(client, h, space)
    path = f"/api/v1/items/{item['id']}"
    client.post(path + "/expenses", headers={**h, "If-Match": '"1"', "Idempotency-Key": "event-expense"}, json={"category": "维修", "amount_cents": 100, "occurred_on": "2026-10-19"})
    first = client.get(path + "/events?limit=1", headers=h).json()
    assert first["items"][0]["type"] == "expense_created"
    second = client.get(
        path + "/events", headers=h, params={"limit": 1, "cursor": first["next_cursor"]}
    ).json()
    assert second["items"][0]["type"] == "item_created"
    assert second["items"][0]["occurred_on"] is None
    assert second["next_cursor"] is None


def test_production_dev_login_not_exposed(environment):
    _, engine, settings, storage = environment
    with pytest.raises(ValidationError):
        Settings(app_env="production", dev_auth_enabled=True)
    production = settings.model_copy(update={"app_env": "production", "dev_auth_enabled": False})
    with TestClient(create_app(production, engine=engine, storage=storage)) as client:
        assert client.post("/api/v1/auth/dev/login", json={"identity": "alice"}).status_code == 404
        assert "/api/v1/auth/dev/login" not in client.get("/openapi.json").json()["paths"]


def test_wechat_login_does_not_expose_provider_secrets(client, monkeypatch):
    monkeypatch.setattr("app.api.wechat_identity", lambda settings, code: "wechat:test:openid")
    first = client.post("/api/v1/auth/wechat/login", json={"code": "temporary-code"})
    second = client.post("/api/v1/auth/wechat/login", json={"code": "other-code"})
    assert first.status_code == second.status_code == 200
    assert first.json()["user"]["id"] == second.json()["user"]["id"]
    assert "openid" not in first.text and "session_key" not in first.text


def test_failed_write_rolls_back_idempotency_and_audit(environment):
    client, engine, _, _ = environment
    h, space, _ = authenticate(client)
    headers = {**h, "Idempotency-Key": "retry-after-failure"}
    path = f"/api/v1/spaces/{space}/items"
    assert (
        client.post(
            path, headers=headers, json={"name": "future", "purchase_date": "2099-01-01"}
        ).status_code
        == 422
    )
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Item)) == 0
        assert db.scalar(select(func.count()).select_from(Event)) == 0
    assert client.post(path, headers=headers, json={"name": "fixed"}).status_code == 201


def test_file_validation_failure_never_makes_file_accessible(environment):
    from app.errors import ApiError

    client, _, _, storage = environment
    h, space, _ = authenticate(client)
    response = client.post(
        "/api/v1/files/uploads",
        headers=h,
        json={
            "space_id": space,
            "purpose": "receipt",
            "name": "invalid.png",
            "mime_type": "image/png",
            "size_bytes": 100,
        },
    )
    file_id = response.json()["id"]

    def fail(file):
        raise ApiError(422, "VALIDATION_ERROR", "Invalid image")

    storage.complete = fail
    assert client.post(f"/api/v1/files/{file_id}/complete", headers=h).status_code == 422
    assert client.get(f"/api/v1/files/{file_id}/access", headers=h).status_code == 404
    assert (
        client.post(
            f"/api/v1/spaces/{space}/items",
            headers={**h, "Idempotency-Key": "badfile"},
            json={"name": "badfile", "image_file_id": file_id},
        ).status_code
        == 404
    )


def test_openapi_and_validation_error_contract(client):
    spec = client.get("/openapi.json").json()
    assert spec["paths"]["/api/v1/files/uploads"]["post"]["responses"]["422"]["content"][
        "application/json"
    ]["schema"]["$ref"].endswith("/ErrorOut")
    response = client.post(
        "/api/v1/auth/refresh", json={"refresh_token": "x", "secret": "do-not-echo"}
    )
    assert response.status_code == 422
    assert "do-not-echo" not in response.text
    assert response.json()["error"]["request_id"] == response.headers["X-Request-ID"]


def test_missing_file_reference_is_not_database_error(client):
    h, space, _ = authenticate(client)
    response = client.post(
        f"/api/v1/spaces/{space}/items",
        headers={**h, "Idempotency-Key": "nonexistent-image"},
        json={"name": "test", "image_file_id": "nonexistent"},
    )
    assert response.status_code == 404
    item = create(client, h, space)
    path = f"/api/v1/items/{item['id']}"
    response = client.patch(
        path, headers={**h, "If-Match": '"1"'}, json={"image_file_id": "nonexistent"}
    )
    assert response.status_code == 404
    assert client.get(path, headers=h).json()["revision"] == 1


def test_native_post_update_aliases(client):
    h, space, _ = authenticate(client)
    item = create(client, h, space)
    path = f"/api/v1/items/{item['id']}"
    response = client.post(
        path + "/update", headers={**h, "If-Match": '"1"'}, json={"name": "native-update"}
    )
    assert response.status_code == 200
    expense = client.post(
        path + "/expenses",
        headers={**h, "If-Match": '"2"', "Idempotency-Key": "native-expense"},
        json={"category": "维修", "amount_cents": 100, "occurred_on": "2026-10-19"},
    ).json()["expenses"][0]
    response = client.post(
        path + f"/expenses/{expense['id']}/update",
        headers={**h, "If-Match": '"3"'},
        json={"amount_cents": 200},
    )
    assert response.status_code == 200
    assert response.json()["expenses"][0]["amount_cents"] == 200


def test_routine_edit_does_not_record_event_and_legacy_edits_are_filtered(environment):
    client, engine, _, _ = environment
    h, space, _ = authenticate(client)
    item = create(client, h, space)
    path = f"/api/v1/items/{item['id']}"
    updated = client.patch(path, headers={**h, "If-Match": '"1"'}, json={"name": "corrected", "purchase_amount_cents": 1234})
    assert updated.status_code == 200, updated.text
    assert updated.json()["revision"] == 2
    assert updated.json()["purchase_amount_cents"] == 1234
    with Session(engine) as db, db.begin():
        assert db.scalar(select(func.count()).select_from(Event)) == 1
        db.add(Event(item_id=item["id"], space_id=space, type="item_updated", title="编辑物品资料", occurred_on=None, actor={"id": "legacy", "display_name": "我"}, changes=[]))
    for endpoint in (path + "/events?limit=1", f"/api/v1/spaces/{space}/events?limit=1"):
        response = client.get(endpoint, headers=h)
        assert response.status_code == 200
        assert [e["type"] for e in response.json()["items"]] == ["item_created"]
        assert response.json()["next_cursor"] is None
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Event)) == 2
