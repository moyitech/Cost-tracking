from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Invitation, Member, now
from tests.conftest import authenticate, create


def post(client, path, headers, body, key=None):
    return client.post(
        "/api/v1" + path, headers={**headers, "Idempotency-Key": key or uuid4().hex}, json=body
    )


def family(client, headers, key=None):
    r = post(client, "/spaces", headers, {"name": "家", "nickname": "家长"}, key)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def invitation(client, headers, space, role="editor"):
    r = post(client, f"/spaces/{space}/invitations", headers, {"role": role})
    assert r.status_code == 201, r.text
    return r.json()


def join(client, headers, invite, nickname="家人", key=None):
    return post(
        client, f"/invitations/{invite['token']}/accept", headers, {"nickname": nickname}, key
    )


def member(client, headers, space, user_id):
    r = client.get(f"/api/v1/spaces/{space}/members", headers=headers)
    assert r.status_code == 200, r.text
    return next(m for m in r.json()["items"] if m["user_id"] == user_id)


def test_family_lifecycle_and_removal_boundary(environment):
    client, engine, *_ = environment
    a, personal, alice = authenticate(client)
    b, bpersonal, bob = authenticate(client, "bob")
    c, _, _ = authenticate(client, "carol")
    space = family(client, a, "create-family")
    assert family(client, a, "create-family") == space
    inv = invitation(client, a, space)
    assert inv["status"] == "active"
    preview = client.get(f"/api/v1/invitations/{inv['token']}", headers=b).json()
    assert preview["inviter_name"] == "家长" and not preview["already_member"]
    assert client.get(f"/api/v1/spaces/{space}/items", headers=b).status_code == 404
    assert join(client, b, inv, key="join-bob").status_code == 200
    assert join(client, c, inv).status_code == 200
    assert join(client, b, inv, nickname="不能覆盖").status_code == 200
    bm = member(client, a, space, bob["user"]["id"])
    assert bm["display_name"] == "家人"
    assert client.get(f"/api/v1/spaces/{personal}/items", headers=b).status_code == 404
    assert client.get(f"/api/v1/spaces/{bpersonal}/summary", headers=a).status_code == 404
    assert client.get(f"/api/v1/spaces/{space}/invitations", headers=b).status_code == 403
    changed = client.post(
        f"/api/v1/spaces/{space}/members/{bm['id']}/update",
        headers={**a, "If-Match": '"1"'},
        json={"role": "viewer"},
    )
    assert changed.status_code == 200, changed.text
    assert post(client, f"/spaces/{space}/items", b, {"name": "不能写"}).status_code == 403
    assert (
        client.delete(
            f"/api/v1/spaces/{space}/members/{bm['id']}", headers={**a, "If-Match": '"1"'}
        ).status_code
        == 409
    )
    assert (
        client.delete(
            f"/api/v1/spaces/{space}/members/{bm['id']}", headers={**a, "If-Match": '"2"'}
        ).status_code
        == 204
    )
    for key in ["join-bob", "new-key"]:
        r = join(client, b, inv, key=key)
        assert (
            r.status_code == 409
            and r.json()["error"]["code"] == "INVITATION_NEW_INVITATION_REQUIRED"
        )
    new = invitation(client, a, space, "viewer")
    assert join(client, b, new).status_code == 200
    updated = client.post(
        f"/api/v1/spaces/{space}/members/me/update",
        headers={**b, "If-Match": '"1"'},
        json={"nickname": "小明"},
    )
    assert updated.status_code == 200 and updated.json()["display_name"] == "小明"
    events = client.get(f"/api/v1/spaces/{space}/events", headers=a).json()["items"]
    assert any(e["type"] == "member_removed" for e in events)
    assert any(e["actor"]["display_name"] == "家长" for e in events)
    am = member(client, a, space, alice["user"]["id"])
    assert (
        client.delete(
            f"/api/v1/spaces/{space}/members/{am['id']}", headers={**a, "If-Match": '"1"'}
        ).status_code
        == 403
    )
    with Session(engine) as db, db.begin():
        db.get(Invitation, new["id"]).expires_at = now() - timedelta(seconds=1)
    assert join(client, b, new).json()["error"]["code"] == "INVITATION_EXPIRED"
    for _ in range(2):
        assert (
            client.delete(f"/api/v1/spaces/{space}/invitations/{inv['id']}", headers=a).status_code
            == 204
        )
    assert join(client, c, inv).json()["error"]["code"] == "INVITATION_REVOKED"


def test_concurrent_accept_and_member_pagination(environment):
    client, engine, *_ = environment
    a, _, _ = authenticate(client)
    b, _, bob = authenticate(client, "bob")
    space = family(client, a)
    inv = invitation(client, a, space)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: join(client, b, inv), range(4)))
    assert all(r.status_code == 200 for r in results), [r.text for r in results]
    with Session(engine) as db:
        assert (
            len(
                list(
                    db.scalars(
                        select(Member).where(
                            Member.space_id == space, Member.user_id == bob["user"]["id"]
                        )
                    )
                )
            )
            == 1
        )
    url = f"/api/v1/spaces/{space}/members?limit=1"
    first = client.get(url, headers=a).json()
    second = client.get(url + "&cursor=" + first["next_cursor"], headers=a).json()
    assert first["items"][0]["id"] != second["items"][0]["id"]
    assert client.get(url + "&cursor=" + first["next_cursor"], headers=b).status_code == 422
    assert (
        client.get(f"/api/v1/spaces/{space}/invitations", headers=a).json()["items"][0][
            "accepted_count"
        ]
        == 1
    )


def test_transfer_identity_history_permissions_and_retry(client):
    a, personal, _ = authenticate(client)
    b, _, _ = authenticate(client, "bob")
    space = family(client, a)
    inv = invitation(client, a, space, "viewer")
    assert join(client, b, inv).status_code == 200
    item = create(client, a, personal, purchase_amount_cents=10000, purchase_date="2026-10-01")
    path = f"/items/{item['id']}/transfer"
    headers = {**a, "If-Match": '"1"'}
    r = post(client, path, headers, {"target_space_id": space}, "move")
    assert r.status_code == 200, r.text
    assert r.json()["id"] == item["id"] and r.json()["revision"] == 2
    assert post(client, path, headers, {"target_space_id": space}, "move").status_code == 200
    assert (
        post(client, path, {**a, "If-Match": '"2"'}, {"target_space_id": personal}).status_code
        == 422
    )
    assert client.get(f"/api/v1/spaces/{personal}/summary", headers=a).json()["item_count"] == 0
    assert client.get(f"/api/v1/spaces/{space}/summary", headers=b).json()["item_count"] == 1
    events = client.get(f"/api/v1/items/{item['id']}/events", headers=b).json()["items"]
    assert len(events) == 2 and events[0]["actor"]["display_name"] == "家长"
    assert (
        post(
            client,
            f"/items/{item['id']}/expenses",
            {**b, "If-Match": '"2"'},
            {"category": "维修", "amount_cents": 100, "occurred_on": "2026-10-10"},
        ).status_code
        == 403
    )


def test_transfer_files_expenses_and_revoked_access(environment):
    client, engine, *_ = environment
    a, personal, _ = authenticate(client)
    b, bpersonal, bob = authenticate(client, "bob")
    space = family(client, a)
    inv = invitation(client, a, space)
    assert join(client, b, inv).status_code == 200
    upload = post(
        client,
        "/files/uploads",
        a,
        {
            "space_id": personal,
            "purpose": "receipt",
            "name": "receipt.png",
            "mime_type": "image/png",
            "size_bytes": 100,
        },
    ).json()
    file_id = upload["id"]
    assert client.post(f"/api/v1/files/{file_id}/complete", headers=a).status_code == 200
    item = create(client, a, personal, attachment_file_ids=[file_id])
    other = create(client, a, personal, attachment_file_ids=[file_id])
    expense = post(
        client,
        f"/items/{item['id']}/expenses",
        {**a, "If-Match": '"1"'},
        {
            "category": "维修",
            "amount_cents": 200,
            "occurred_on": "2026-10-10",
            "attachment_file_ids": [file_id],
        },
    )
    assert expense.status_code == 200, expense.text
    moved = post(
        client,
        f"/items/{item['id']}/transfer",
        {**a, "If-Match": '"2"'},
        {"target_space_id": space},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["expenses"] == expense.json()["expenses"]
    assert moved.json()["attachment_file_ids"] == [file_id]
    assert client.get(f"/api/v1/files/{file_id}/access", headers=b).status_code == 200
    assert client.get(f"/api/v1/items/{other['id']}", headers=b).status_code == 404
    # Editing after transfer keeps the original file links, with target-space authorization.
    edit = client.patch(
        f"/api/v1/items/{item['id']}", headers={**b, "If-Match": '"3"'}, json={"name": "共享电脑"}
    )
    assert edit.status_code == 200, edit.text
    events = client.get(f"/api/v1/items/{item['id']}/events", headers=b).json()["items"]
    transfer_event = next(e for e in events if e["type"] == "item_transferred")
    assert {"field": "space_id", "before": personal, "after": space} in transfer_event["changes"]
    bm = member(client, a, space, bob["user"]["id"])
    assert (
        client.delete(
            f"/api/v1/spaces/{space}/members/{bm['id']}", headers={**a, "If-Match": '"1"'}
        ).status_code
        == 204
    )
    for path in [
        f"/files/{file_id}/access",
        f"/items/{item['id']}",
        f"/items/{item['id']}/events",
        f"/spaces/{space}/items?q=共享",
        f"/spaces/{space}/summary",
        f"/spaces/{space}/analytics",
        f"/spaces/{space}/events",
        f"/spaces/{space}/imports",
    ]:
        assert client.get("/api/v1" + path, headers=b).status_code == 404, path
    assert (
        client.patch(
            f"/api/v1/items/{item['id']}",
            headers={**b, "If-Match": '"4"'},
            json={"name": "失权写入"},
        ).status_code
        == 404
    )
    assert client.get(f"/api/v1/files/{file_id}/access", headers=a).status_code == 200
    assert client.get(f"/api/v1/spaces/{bpersonal}/items", headers=b).status_code == 200


def test_failed_transfer_keeps_source_and_no_events(client):
    a, personal, _ = authenticate(client)
    b, _, _ = authenticate(client, "bob")
    target = family(client, b)
    inv = invitation(client, b, target, "viewer")
    assert join(client, a, inv).status_code == 200
    item = create(client, a, personal)
    path = f"/items/{item['id']}/transfer"
    denied = post(client, path, {**a, "If-Match": '"1"'}, {"target_space_id": target})
    assert denied.status_code == 403
    target = family(client, a)
    stale = post(client, path, {**a, "If-Match": '"2"'}, {"target_space_id": target})
    assert stale.status_code == 409
    missing = post(client, path, a, {"target_space_id": target})
    assert missing.status_code == 428
    unchanged = client.get(f"/api/v1/items/{item['id']}", headers=a).json()
    assert unchanged["space_id"] == personal and unchanged["revision"] == 1
    assert len(client.get(f"/api/v1/items/{item['id']}/events", headers=a).json()["items"]) == 1


def test_revoke_and_accept_are_serialized(environment):
    client, engine, *_ = environment
    a, _, _ = authenticate(client)
    b, _, bob = authenticate(client, "bob")
    space = family(client, a)
    inv = invitation(client, a, space)
    with ThreadPoolExecutor(max_workers=2) as pool:
        accepted = pool.submit(join, client, b, inv)
        revoked = pool.submit(
            client.delete, f"/api/v1/spaces/{space}/invitations/{inv['id']}", headers=a
        )
        acceptance, revocation = accepted.result(), revoked.result()
    assert revocation.status_code == 204
    assert acceptance.status_code in (200, 409), acceptance.text
    with Session(engine) as db:
        exists = db.scalar(
            select(Member).where(Member.space_id == space, Member.user_id == bob["user"]["id"])
        )
        assert bool(exists) == (acceptance.status_code == 200)
    assert join(client, b, inv).status_code == 409


def test_upgrade_preserves_existing_personal_data(environment):
    from alembic import command
    from alembic.config import Config

    client, engine, *_ = environment
    headers, personal, _ = authenticate(client)
    item = create(client, headers, personal, name="已有个人档案")
    # Exercise the migration against existing A/B data in this disposable schema.
    with engine.begin() as conn:
        config = Config("alembic.ini")
        config.attributes["connection"] = conn
        command.downgrade(config, "e8b31d2f6a90")
        command.upgrade(config, "head")
    after = client.get(f"/api/v1/items/{item['id']}", headers=headers)
    assert after.status_code == 200 and after.json() == item
    assert client.get("/api/v1/spaces", headers=headers).json()["items"][0]["id"] == personal
    assert family(client, headers)


def test_mini_code_permissions_expiry_and_token_compatibility(environment, monkeypatch):
    client, engine, *_ = environment
    a, _, _ = authenticate(client, 'code-admin')
    b, _, _ = authenticate(client, 'code-editor')
    c, _, _ = authenticate(client, 'code-outsider')
    space = family(client, a)
    inv = invitation(client, a, space)
    assert len(inv['token']) == 32
    assert join(client, b, inv).status_code == 200
    calls = []
    monkeypatch.setattr(client.app.state.wechat_codes, 'generate', lambda token: calls.append(token) or 'iVBORw0KGgo=')
    path = f"/api/v1/spaces/{space}/invitations/{inv['id']}/mini-code"
    assert client.post(path, headers=b).status_code == 403
    assert client.post(path, headers=c).status_code == 404
    result = client.post(path, headers=a)
    assert result.status_code == 200
    assert result.json()['content_type'] == 'image/png'
    assert result.json()['expires_at'] == inv['expires_at']
    assert result.headers['cache-control'] == 'no-store'
    assert calls == [inv['token']]
    with Session(engine) as db:
        row = db.get(Invitation, inv['id'])
        row.expires_at = now() - timedelta(seconds=1)
        db.commit()
    assert client.post(path, headers=a).status_code == 409
    assert len(calls) == 1
    legacy = invitation(client, a, space)
    with Session(engine) as db:
        row = db.get(Invitation, legacy['id'])
        row.token = 'L' * 43
        db.commit()
    assert client.get('/api/v1/invitations/' + 'L' * 43, headers=c).status_code == 200
    assert join(client, c, {**legacy, 'token': 'L' * 43}).status_code == 200
    revoked = invitation(client, a, space)
    assert client.delete(f"/api/v1/spaces/{space}/invitations/{revoked['id']}", headers=a).status_code == 204
    assert client.post(f"/api/v1/spaces/{space}/invitations/{revoked['id']}/mini-code", headers=a).status_code == 409


def test_share_cover_is_public_png(client):
    from io import BytesIO

    from PIL import Image
    response = client.get('/api/v1/assets/invitation-cover.png')
    assert response.status_code == 200
    assert response.headers['content-type'] == 'image/png'
    assert Image.open(BytesIO(response.content)).size == (1000, 800)


def test_member_role_order_is_global_across_pages_and_scoped_to_viewer(environment):
    client, *_ = environment
    admin, _, admin_user = authenticate(client, "roster-admin")
    editor, _, editor_user = authenticate(client, "roster-editor")
    peer, _, peer_user = authenticate(client, "roster-peer")
    viewer, _, viewer_user = authenticate(client, "roster-viewer")
    space = family(client, admin)
    inv = invitation(client, admin, space)
    assert join(client, editor, inv).status_code == 200
    assert join(client, peer, inv).status_code == 200
    assert join(client, viewer, invitation(client, admin, space, "viewer")).status_code == 200

    def pages(headers):
        rows, cursors = [], []
        params = {"limit": 1}
        while True:
            r = client.get(f"/api/v1/spaces/{space}/members", headers=headers, params=params)
            assert r.status_code == 200, r.text
            rows.extend(r.json()["items"])
            cursor = r.json()["next_cursor"]
            if cursor is None:
                return rows, cursors
            assert cursor not in cursors
            cursors.append(cursor)
            params["cursor"] = cursor

    rows, cursors = pages(editor)
    assert [r["user_id"] for r in rows] == [u["user"]["id"] for u in [admin_user, editor_user, peer_user, viewer_user]]
    assert len({r["id"] for r in rows}) == 4
    assert [r["role"] for r in pages(viewer)[0]] == ["admin", "editor", "editor", "viewer"]
    assert [r["user_id"] for r in pages(admin)[0]][:3] == [u["user"]["id"] for u in [admin_user, peer_user, editor_user]]
    assert client.get(f"/api/v1/spaces/{space}/members", headers=viewer, params={"cursor": cursors[0]}).status_code == 422
