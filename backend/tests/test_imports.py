from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from threading import Event as ThreadEvent
from uuid import uuid4

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai import recognize
from app.errors import ApiError
from app.import_schemas import CommitInput
from app.imports import commit_import
from app.models import Idempotency, ImportEntry, ImportSource, Item, Member, now
from app.worker import claim, process
from tests.conftest import authenticate, create


def setup(environment, count=1):
    c, engine, settings, storage = environment
    settings.ai_enabled = True
    settings.ai_api_key = SecretStr("test-key")
    settings.ai_model = "deepseek-flash"
    h, space, login = authenticate(c)
    ids = []
    for _ in range(count):
        r = c.post(
            "/api/v1/files/uploads",
            headers=h,
            json={
                "space_id": space,
                "purpose": "import_source",
                "name": "order.png",
                "mime_type": "image/png",
                "size_bytes": 80,
            },
        )
        assert r.status_code == 201
        fid = r.json()["id"]
        assert c.post(f"/api/v1/files/{fid}/complete", headers=h).status_code == 200
        ids.append(fid)
    payload = {"source_file_ids": ids}
    r = c.post(
        f"/api/v1/spaces/{space}/imports", headers={**h, "Idempotency-Key": "create"}, json=payload
    )
    assert r.status_code == 202, r.text
    return c, engine, settings, storage, h, space, login["user"]["id"], r.json(), payload


def get(c, h, task):
    r = c.get(f"/api/v1/imports/{task['id']}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def detected(name="相机"):
    return [
        {
            "values": {"name": name, "purchase_amount_cents": 10000, "purchase_date": "2026-10-01"},
            "field_sources": {"name": {"text": name}},
            "warnings": [],
            "source_indexes": [1],
        }
    ]


def patch(c, h, task, entry, body):
    return c.post(
        f"/api/v1/imports/{task['id']}/entries/{entry['id']}/update",
        headers={**h, "If-Match": f'"{entry["revision"]}"'},
        json=body,
    )


def submit(c, h, task, key=None):
    return c.post(
        f"/api/v1/imports/{task['id']}/commit",
        headers={**h, "Idempotency-Key": key or uuid4().hex},
        json={
            "entries": [{"entry_id": e["id"], "revision": e["revision"]} for e in task["entries"]]
        },
    )


def test_create_recognize_review_commit_replay_and_private_sources(environment):
    c, engine, settings, storage, h, space, _, task, payload = setup(environment)
    assert (
        c.post(
            f"/api/v1/spaces/{space}/imports",
            headers={**h, "Idempotency-Key": "create"},
            json=payload,
        ).json()
        == task
    )
    process(engine, settings, storage, claim(engine, settings), lambda *_: detected())
    task = get(c, h, task)
    assert task["status"] == "ready" and not task["entries"][0]["confirmed"]
    assert not c.get(f"/api/v1/spaces/{space}/items", headers=h).json()["items"]
    assert (
        patch(
            c, h, task, task["entries"][0], {"values": {"name": "我的相机"}, "confirmed": True}
        ).status_code
        == 200
    )
    task = get(c, h, task)
    response = submit(c, h, task, key="commit")
    assert response.status_code == 200, response.text
    assert response.json()["results"][0]["status"] == "saved"
    assert submit(c, h, task, key="commit").json() == response.json()
    assert submit(c, h, task).json()["results"][0]["status"] == "already_saved"
    assert len(c.get(f"/api/v1/spaces/{space}/items", headers=h).json()["items"]) == 1
    other_h, _, _ = authenticate(c, "other")
    assert c.get(f"/api/v1/imports/{task['id']}", headers=other_h).status_code == 404
    assert (
        c.get(f"/api/v1/files/{payload['source_file_ids'][0]}/access", headers=other_h).status_code
        == 404
    )
    assert (
        c.delete(
            f"/api/v1/imports/{task['id']}/sources/{task['sources'][0]['id']}", headers=h
        ).status_code
        == 409
    )


def test_legacy_recognized_fields_do_not_break_review_or_commit(environment):
    c, engine, settings, storage, h, space, user_id, task, payload = setup(environment)
    process(
        engine, settings, storage, claim(engine, settings), lambda *_: detected("索尼 A7M4 相机")
    )
    task = get(c, h, task)
    entry_id = task["entries"][0]["id"]
    retired = {"category", "brand", "model", "location", "channel", "serial", "warranty"}
    with Session(engine) as db, db.begin():
        entry = db.get(ImportEntry, entry_id)
        entry.recognized = {**entry.recognized, **dict.fromkeys(retired, "旧资料")}
        entry.overrides = {"brand": "旧品牌", "note": "核对完成"}
        entry.field_sources = {**entry.field_sources, "model": {"text": "A7M4"}}
    task = get(c, h, task)
    entry = task["entries"][0]
    assert not retired & entry["values"].keys()
    assert not retired & entry["field_sources"].keys()
    assert entry["values"]["name"] == "索尼 A7M4 相机"
    with Session(engine) as db, db.begin():
        receipt = db.get(Idempotency, (user_id, f"import-create:{space}", "create"))
        receipt.response = {
            **task,
            "entries": [
                {
                    **entry,
                    "values": {**entry["values"], **dict.fromkeys(retired, "旧资料")},
                    "field_sources": {"model": {"text": "A7M4"}},
                }
            ],
        }
    replay = c.post(
        f"/api/v1/spaces/{space}/imports", headers={**h, "Idempotency-Key": "create"}, json=payload
    )
    assert replay.status_code == 202
    assert not retired & replay.json()["entries"][0]["values"].keys()
    assert not retired & replay.json()["entries"][0]["field_sources"].keys()
    assert patch(c, h, task, entry, {"confirmed": True}).status_code == 200
    task = get(c, h, task)
    assert submit(c, h, task).json()["results"][0]["status"] == "saved"
    saved = c.get(f"/api/v1/spaces/{space}/items", headers=h).json()["items"][0]
    assert saved["name"] == "索尼 A7M4 相机" and saved["note"] == "核对完成"
    assert saved["purchase_amount_cents"] == 10000 and not retired & saved.keys()


def test_batch_failure_retry_is_atomic_and_replayed(environment):
    c, engine, settings, storage, h, _, _, task, _ = setup(environment, 2)
    assert task["entries"] == []

    def fail(*_):
        raise ApiError(503, "AI_TIMEOUT", "识别超时")

    process(engine, settings, storage, claim(engine, settings), fail)
    task = get(c, h, task)
    assert task["status"] == "failed" and task["entries"] == []
    assert all(s["status"] == "failed" for s in task["sources"])
    assert claim(engine, settings) is None
    url = f"/api/v1/imports/{task['id']}/retry"
    headers = {**h, "Idempotency-Key": "retry"}
    assert (
        c.post(
            url, headers=headers, json={"sources": [{"source_id": task["sources"][0]["id"]}]}
        ).status_code
        == 409
    )
    response = c.post(url, headers=headers, json={})
    assert response.status_code == 202
    assert c.post(url, headers=headers, json={}).json() == response.json()
    rows = detected()
    rows[0]["source_indexes"] = [1, 2]
    process(engine, settings, storage, claim(engine, settings), lambda *_: rows)
    task = get(c, h, task)
    assert len(task["entries"]) == 1 and task["status"] == "ready"
    assert set(task["entries"][0]["source_ids"]) == {s["id"] for s in task["sources"]}
    assert all(s["attempts"] == 2 for s in task["sources"])


def test_fixed_sources_and_cancel_preserve_saved_items(environment):
    c, engine, settings, storage, h, space, _, task, payload = setup(environment)
    assert (
        c.post(f"/api/v1/imports/{task['id']}/sources", headers=h, json=payload).status_code == 409
    )
    assert (
        c.delete(
            f"/api/v1/imports/{task['id']}/sources/{task['sources'][0]['id']}", headers=h
        ).status_code
        == 409
    )
    job = claim(engine, settings)
    process(engine, settings, storage, job, lambda *_: detected())
    task = get(c, h, task)
    patch(c, h, task, task["entries"][0], {"confirmed": True})
    assert submit(c, h, get(c, h, task)).json()["results"][0]["status"] == "saved"
    assert c.delete(f"/api/v1/imports/{task['id']}", headers=h).status_code == 204
    process(engine, settings, storage, job, lambda *_: detected("迟到"))
    assert get(c, h, task)["status"] == "canceled"
    assert len(c.get(f"/api/v1/spaces/{space}/items", headers=h).json()["items"]) == 1


def test_partial_commit_revision_and_duplicate_decision(environment):
    c, engine, settings, storage, h, space, _, task, _ = setup(environment)
    create(c, h, space, name="相机")
    process(
        engine, settings, storage, claim(engine, settings), lambda *_: detected() + detected("耳机")
    )
    task = get(c, h, task)
    for entry in task["entries"]:
        assert patch(c, h, task, entry, {"confirmed": True}).status_code == 200
    assert patch(c, h, task, task["entries"][0], {"confirmed": True}).status_code == 409
    task = get(c, h, task)
    assert [x["status"] for x in submit(c, h, task, key="partial").json()["results"]] == [
        "failed",
        "saved",
    ]
    task = get(c, h, task)
    assert (
        patch(
            c,
            h,
            task,
            task["entries"][0],
            {"duplicate_decision": "create_independent", "confirmed": True},
        ).status_code
        == 200
    )
    assert [x["status"] for x in submit(c, h, get(c, h, task)).json()["results"]] == [
        "saved",
        "already_saved",
    ]


def test_multi_image_batch_has_one_claim_and_one_provider_call(environment):
    c, engine, settings, storage, h, _, _, task, _ = setup(environment, 3)
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs = list(pool.map(lambda _: claim(engine, settings), range(3)))
    jobs = [j for j in jobs if j]
    assert len(jobs) == 1 and len(jobs[0][1]) == 3
    assert get(c, h, task)["entries"] == []
    calls = []

    def provider(_, urls):
        calls.append(urls)
        assert len(urls) == 3 and len(set(urls)) == 3
        rows = detected() + detected("另一订单同款")
        rows[0]["source_indexes"] = [1, 2]
        rows[1]["source_indexes"] = [3]
        return rows

    process(engine, settings, storage, jobs[0], provider)
    assert len(calls) == 1
    task = get(c, h, task)
    assert task["status"] == "ready" and len(task["entries"]) == 2
    assert [len(e["source_ids"]) for e in task["entries"]] == [2, 1]


def test_concurrent_commits_create_once(environment):
    c, engine, settings, storage, h, _, user_id, task, _ = setup(environment)
    process(engine, settings, storage, claim(engine, settings), lambda *_: detected())
    task = get(c, h, task)
    patch(c, h, task, task["entries"][0], {"confirmed": True})
    task = get(c, h, task)
    body = CommitInput(
        entries=[{"entry_id": task["entries"][0]["id"], "revision": task["entries"][0]["revision"]}]
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [
            pool.submit(commit_import, engine, user_id, task["id"], body, key, date(2026, 10, 19))
            for key in ["a", "b"]
        ]
        results = [f.result(timeout=10)["results"][0] for f in jobs]
    assert {r["status"] for r in results} == {"saved", "already_saved"}
    assert len({r["item_id"] for r in results}) == 1


def test_permissions_rechecked_before_processing_and_commit(environment):
    c, engine, settings, storage, h, space, user_id, task, _ = setup(environment)
    job = claim(engine, settings)
    with Session(engine) as db, db.begin():
        db.scalar(
            select(Member).where(Member.user_id == user_id, Member.space_id == space)
        ).role = "viewer"
    process(engine, settings, storage, job, lambda *_: detected())
    assert get(c, h, task)["sources"][0]["status"] == "failed"
    assert (
        c.post(
            f"/api/v1/imports/{task['id']}/commit",
            headers={**h, "Idempotency-Key": "denied"},
            json={"entries": [{"entry_id": "unavailable", "revision": 1}]},
        ).status_code
        == 403
    )


def test_lease_recovery_fences_stale_result(environment):
    c, engine, settings, storage, h, _, _, task, _ = setup(environment)
    old = claim(engine, settings)
    with Session(engine) as db, db.begin():
        for source_id, _ in old[1]:
            db.get(ImportSource, source_id).lease_until = now() - timedelta(seconds=1)
    new = claim(engine, settings)
    assert all(b[1] > a[1] for a, b in zip(old[1], new[1]))
    process(engine, settings, storage, new, lambda *_: detected("新结果"))
    process(engine, settings, storage, old, lambda *_: detected("旧结果"))
    assert get(c, h, task)["entries"][0]["values"]["name"] == "新结果"


def test_ai_thinking_no_token_cap_ambiguous_price_and_quantity(environment):
    _, _, s, _ = environment
    s.ai_enabled = True
    s.ai_api_key = SecretStr("test")
    s.ai_model = "deepseek-flash"
    s.ai_base_url = "https://api.deepseek.com"
    s.ai_thinking_enabled = True
    s.ai_max_output_tokens = None

    def provider(request):
        import json

        p = json.loads(request.content)
        assert "max_tokens" not in p and p["thinking"] == {"type": "enabled"}
        assert p["response_format"] == {"type": "json_object"}
        assert p["messages"][1]["content"][2]["image_url"]["url"] == "https://cos.example/signed"
        items = [
            {
                "name": "耳机",
                "quantity": 2,
                "purchase_amount_cents": 10000,
                "amount_scope": "line_total",
            },
            {
                "name": "赠品",
                "quantity": 1,
                "purchase_amount_cents": 0,
                "amount_scope": "single_unit",
                "is_gift": True,
                "evidence": {"is_gift": {"text": "赠品"}},
            },
        ]
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": json.dumps(
                                {"items": [{"source_indexes": [1], **item} for item in items]}
                            )
                        },
                    }
                ]
            },
        )

    entries = recognize(s, ["https://cos.example/signed"], httpx.MockTransport(provider))
    assert [e["values"]["purchase_amount_cents"] for e in entries] == [None, None, 0]


def test_committed_entry_survives_later_failure(environment, monkeypatch):
    c, engine, settings, storage, h, _, _, task, _ = setup(environment)
    process(
        engine, settings, storage, claim(engine, settings), lambda *_: detected() + detected("镜头")
    )
    task = get(c, h, task)
    for entry in task["entries"]:
        patch(c, h, task, entry, {"confirmed": True})
    task = get(c, h, task)
    import app.imports as impl

    original = impl.commit_one
    calls = 0

    def crash(*args):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("simulated process failure")
        return original(*args)

    monkeypatch.setattr(impl, "commit_one", crash)
    with pytest.raises(RuntimeError):
        submit(c, h, task, key="resume")
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Item)) == 1
        assert (
            db.scalar(
                select(func.count())
                .select_from(ImportEntry)
                .where(ImportEntry.saved_item_id.is_not(None))
            )
            == 1
        )
    monkeypatch.setattr(impl, "commit_one", original)
    assert [r["status"] for r in submit(c, h, task, key="resume").json()["results"]] == [
        "already_saved",
        "saved",
    ]


def test_cancel_during_model_call_does_not_publish_results(environment):
    c, engine, settings, storage, h, _, _, task, _ = setup(environment)
    job = claim(engine, settings)
    started, finish = ThreadEvent(), ThreadEvent()

    def slow(*_):
        started.set()
        assert finish.wait(10)
        return detected()

    with ThreadPoolExecutor() as pool:
        future = pool.submit(process, engine, settings, storage, job, slow)
        assert started.wait(5)
        assert c.delete(f"/api/v1/imports/{task['id']}", headers=h).status_code == 204
        finish.set()
        future.result(timeout=10)
    task = get(c, h, task)
    assert task["status"] == "canceled"
    assert task["entries"] == []
    assert claim(engine, settings) is None


def test_batch_user_queue_limit(environment):
    c, _, settings, _, h, space, _, _, payload = setup(environment, 2)
    settings.ai_import_max_active_sources = 2
    response = c.post(
        f"/api/v1/spaces/{space}/imports", headers={**h, "Idempotency-Key": "another"}, json=payload
    )
    assert response.status_code == 429 and response.headers["Retry-After"] == "2"


def test_invalid_date_still_blocks_commit_without_quantity_confirmation(environment):
    c, engine, settings, storage, h, _, _, task, _ = setup(environment)
    rows = detected()
    process(engine, settings, storage, claim(engine, settings), lambda *_: rows)
    task = get(c, h, task)
    patch(
        c,
        h,
        task,
        task["entries"][0],
        {"values": {"purchase_date": "2099-01-01"}, "confirmed": True},
    )
    task = get(c, h, task)
    assert (
        submit(c, h, task).json()["results"][0]["error"]["field_errors"][0]["code"] == "FUTURE_DATE"
    )
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Item)) == 0


@pytest.mark.parametrize(("scope", "amount"), [("single_unit", 1299900), ("line_total", None)])
@pytest.mark.parametrize("old_client", [False, True])
def test_price_saves_without_quantity_confirmation(environment, scope, amount, old_client):
    from tests.test_ai import recognize_items

    c, engine, settings, storage, h, space, _, task, _ = setup(environment)
    rows = recognize_items(
        [
            {
                "name": "测试手机",
                "quantity": None,
                "purchase_amount_cents": 1299900,
                "amount_scope": scope,
                "amount_kind": "displayed",
            }
        ]
    )
    process(engine, settings, storage, claim(engine, settings), lambda *_: rows)
    task = get(c, h, task)
    entry = task["entries"][0]
    # Existing tasks may retain the retired false flag; they must also save.
    with Session(engine) as db, db.begin():
        db.get(ImportEntry, entry["id"]).legacy_quantity_resolved = False
    assert entry["values"]["purchase_amount_cents"] == amount
    assert "quantity_resolved" not in entry
    body = {"confirmed": True}
    if old_client:
        body["quantity_resolved"] = False
    assert patch(c, h, task, entry, body).status_code == 200
    task = get(c, h, task)
    assert submit(c, h, task).json()["results"][0]["status"] == "saved"
    assert submit(c, h, task).json()["results"][0]["status"] == "already_saved"
    items = c.get(f"/api/v1/spaces/{space}/items", headers=h).json()["items"]
    assert len(items) == 1 and items[0]["purchase_amount_cents"] == amount
    schemas = c.get("/openapi.json").json()["components"]["schemas"]
    assert "quantity_resolved" not in schemas["EntryPatch"]["properties"]
    assert "quantity_resolved" not in schemas["EntryOut"]["properties"]


def test_canceled_orders_are_absent_from_review(environment):
    from tests.test_ai import order_rows, recognize_items

    c, engine, settings, storage, h, space, _, task, _ = setup(environment)
    process(
        engine, settings, storage, claim(engine, settings), lambda *_: recognize_items(order_rows())
    )
    task = get(c, h, task)
    assert task["status"] == "ready"
    assert len(task["entries"]) == 3
    assert all(e["included"] and not e["confirmed"] for e in task["entries"])
    assert not c.get(f"/api/v1/spaces/{space}/items", headers=h).json()["items"]


def test_all_canceled_is_ready_with_no_included_placeholder(environment):
    from tests.test_ai import recognize_items

    c, engine, settings, storage, h, _, _, task, _ = setup(environment)
    rows = recognize_items(
        [
            {"name": "已取消商品", "order_ref": "order_1", "order_status": "canceled"},
            {"name": None, "is_gift": True, "order_ref": "order_1"},
        ]
    )
    process(engine, settings, storage, claim(engine, settings), lambda *_: rows)
    task = get(c, h, task)
    assert task["status"] == "ready" and task["entries"] == []


def test_repeated_worker_result_does_not_overwrite_edits(environment):
    c, engine, settings, storage, h, _, _, task, _ = setup(environment)
    job = claim(engine, settings)
    process(engine, settings, storage, job, lambda *_: detected())
    task = get(c, h, task)
    patch(c, h, task, task["entries"][0], {"values": {"name": "自己填写"}, "included": False})
    process(engine, settings, storage, job, lambda *_: detected("旧结果"))
    entry = get(c, h, task)["entries"][0]
    assert entry["values"]["name"] == "自己填写" and not entry["included"]


def test_invalid_batch_provenance_fails_all_sources(environment):
    c, engine, settings, storage, h, _, _, task, _ = setup(environment, 2)
    rows = detected()
    rows[0]["source_indexes"] = [3]
    process(engine, settings, storage, claim(engine, settings), lambda *_: rows)
    task = get(c, h, task)
    assert task["status"] == "failed" and task["entries"] == []
    assert all(s["status"] == "failed" for s in task["sources"])
