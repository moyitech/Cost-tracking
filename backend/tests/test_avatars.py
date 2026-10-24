from uuid import uuid4

from tests.conftest import authenticate, create
from tests.test_families import family, invitation, join, member


def upload(client, headers, space, purpose="personal_avatar", complete=True):
    response = client.post("/api/v1/files/uploads", headers=headers, json={
        "space_id": space, "purpose": purpose, "name": "头像",
        "mime_type": "image/png", "size_bytes": 128,
    })
    assert response.status_code == 201, response.text
    file_id = response.json()["id"]
    if complete:
        response = client.post(f"/api/v1/files/{file_id}/complete", headers=headers)
        assert response.status_code == 200, response.text
    return file_id


def save(client, headers, file_id, space=None):
    path = f"/spaces/{space}/avatar" if space else "/me/avatar"
    return client.post("/api/v1" + path, headers=headers, json={"avatar_file_id": file_id})


def test_personal_avatar_persists_and_restores(client):
    headers, personal, _ = authenticate(client)
    file_id = upload(client, headers, personal)
    assert save(client, headers, file_id).json()["avatar_file_id"] == file_id
    assert client.get("/api/v1/me", headers=headers).json()["avatar_file_id"] == file_id
    spaces = client.get("/api/v1/spaces", headers=headers).json()["items"]
    assert spaces[0]["avatar_file_id"] == file_id
    assert spaces[0]["member_count"] == 1 and spaces[0]["item_count"] == 0
    assert save(client, headers, file_id).status_code == 200
    assert save(client, headers, None).json()["avatar_file_id"] is None


def test_personal_avatar_visible_only_to_current_family_members(client):
    a, personal, alice = authenticate(client)
    b, _, bob = authenticate(client, "bob")
    c, _, _ = authenticate(client, "stranger")
    space = family(client, a)
    join(client, b, invitation(client, a, space))
    file_id = upload(client, a, personal)
    assert save(client, a, file_id).status_code == 200
    path = f"/api/v1/files/{file_id}/access"
    assert client.get(path, headers=b).status_code == 200
    assert client.get(path, headers=c).status_code == 404
    assert member(client, b, space, alice["user"]["id"])["avatar_file_id"] == file_id
    bm = member(client, a, space, bob["user"]["id"])
    client.delete(f"/api/v1/spaces/{space}/members/{bm['id']}",
                  headers={**a, "If-Match": '"1"'})
    assert client.get(path, headers=b).status_code == 404
    assert client.get(path, headers=a).status_code == 200


def test_replaced_personal_avatar_no_longer_shared(client):
    a, personal, _ = authenticate(client)
    b, _, _ = authenticate(client, "bob")
    space = family(client, a)
    join(client, b, invitation(client, a, space))
    old = upload(client, a, personal)
    new = upload(client, a, personal)
    save(client, a, old)
    save(client, a, new)
    assert client.get(f"/api/v1/files/{old}/access", headers=b).status_code == 404
    assert client.get(f"/api/v1/files/{new}/access", headers=b).status_code == 200


def test_family_avatar_admin_only_and_independent(client):
    a, personal, _ = authenticate(client)
    b, bpersonal, _ = authenticate(client, "bob")
    space = family(client, a)
    join(client, b, invitation(client, a, space))
    own = upload(client, a, personal)
    shared = upload(client, a, space, "family_avatar")
    save(client, a, own)
    assert save(client, a, shared, space).json()["avatar_file_id"] == shared
    assert save(client, b, None, space).status_code == 403
    denied = client.post("/api/v1/files/uploads", headers=b, json={
        "space_id": space, "purpose": "family_avatar", "name": "头像",
        "mime_type": "image/png", "size_bytes": 128,
    })
    assert denied.status_code == 403
    assert client.get(f"/api/v1/files/{shared}/access", headers=b).status_code == 200
    foreign = upload(client, b, bpersonal)
    assert save(client, a, foreign).status_code == 404
    assert save(client, a, own, space).status_code == 422
    assert save(client, a, None, space).status_code == 200
    assert client.get("/api/v1/me", headers=a).json()["avatar_file_id"] == own
    assert client.get(f"/api/v1/files/{shared}/access", headers=b).status_code == 404


def test_avatar_rejects_pending_unknown_and_item_images(client):
    headers, personal, _ = authenticate(client)
    pending = upload(client, headers, personal, complete=False)
    assert save(client, headers, pending).status_code == 404
    assert save(client, headers, str(uuid4())).status_code == 404
    ordinary = upload(client, headers, personal, "item_image")
    assert save(client, headers, ordinary).status_code == 422
    avatar = upload(client, headers, personal)
    result = client.post(f"/api/v1/spaces/{personal}/items", headers={
        **headers, "Idempotency-Key": uuid4().hex,
    }, json={"name": "不能混用头像", "image_file_id": avatar})
    assert result.status_code == 422


def test_space_counts_reflect_deleted_items(client):
    headers, personal, _ = authenticate(client)
    item = create(client, headers, personal)
    assert client.get("/api/v1/spaces", headers=headers).json()["items"][0]["item_count"] == 1
    client.delete(f"/api/v1/items/{item['id']}", headers={**headers, "If-Match": '"1"'})
    assert client.get("/api/v1/spaces", headers=headers).json()["items"][0]["item_count"] == 0
