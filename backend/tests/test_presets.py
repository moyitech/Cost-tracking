import hashlib
import json

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import FileLink, Idempotency, ImagePreset, Item, StoredFile
from app.schemas import ItemCreate
from app.worker import claim, process
from tests.conftest import authenticate, create
from tests.test_imports import detected, get, patch, setup, submit


def seed_presets(engine):
    with Session(engine) as db, db.begin():
        for index, (pid, style, enabled) in enumerate(
            [
                ("emoji-phone-v1", "cartoon", True),
                ("realistic-phone-v1", "realistic", True),
                ("emoji-retired-v1", "cartoon", False),
            ]
        ):
            db.add(
                ImagePreset(
                    id=pid,
                    name="手机",
                    style=style,
                    version=1,
                    sort_order=index,
                    object_key=f"image-presets/{pid}/original.png",
                    preview_object_key=f"image-presets/{pid}/preview.png",
                    enabled=enabled,
                )
            )


def test_catalog_is_shared_but_does_not_grant_private_file_access(environment):
    c, engine, _, storage = environment
    seed_presets(engine)
    h, space, _ = authenticate(c)
    other, other_space, _ = authenticate(c, "bob")
    assert c.get("/api/v1/image-presets").status_code == 401
    entries = c.get("/api/v1/image-presets", headers=h).json()["items"]
    assert [p["id"] for p in entries] == ["emoji-phone-v1", "realistic-phone-v1"]
    assert all(p["preview_url"].endswith("preview.png") for p in entries)
    assert all(p["url"].endswith("original.png") and p["expires_at"] for p in entries)
    assert {p["id"] for p in c.get("/api/v1/image-presets", headers=other).json()["items"]} == {
        p["id"] for p in entries
    }
    for headers, sid in ((h, space), (other, other_space)):
        item = create(c, headers, sid, image_preset_id="emoji-phone-v1")
        assert item["image_file_id"] is None
        assert item["image_preset_id"] == "emoji-phone-v1"
        assert c.get(f"/api/v1/items/{item['id']}", headers=headers).json() == item
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(StoredFile)) == 0
        assert db.scalar(select(func.count()).select_from(FileLink)) == 0
    assert storage.completed == []
    assert c.get("/api/v1/files/emoji-phone-v1/access", headers=h).status_code == 404
    assert c.get("/api/v1/image-presets/missing/access", headers=h).status_code == 404


def test_image_source_switches_permissions_and_db_constraint(environment):
    c, engine, _, _ = environment
    seed_presets(engine)
    h, space, _ = authenticate(c)
    other, _, _ = authenticate(c, "bob")
    upload = c.post(
        "/api/v1/files/uploads",
        headers=h,
        json={
            "space_id": space,
            "purpose": "item_image",
            "name": "private.png",
            "mime_type": "image/png",
            "size_bytes": 100,
        },
    ).json()
    fid = upload["id"]
    assert c.post(f"/api/v1/files/{fid}/complete", headers=h).status_code == 200
    item = create(c, h, space, image_file_id=fid)
    path = f"/api/v1/items/{item['id']}"
    r = c.patch(
        path, headers={**h, "If-Match": '"1"'}, json={"image_preset_id": "realistic-phone-v1"}
    )
    assert r.status_code == 200 and r.json()["image_file_id"] is None
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(FileLink)) == 0
    assert c.get(f"/api/v1/files/{fid}/access", headers=other).status_code == 404
    assert c.get(f"/api/v1/image-presets/{fid}/access", headers=other).status_code == 404
    for values in (
        {"image_preset_id": "unknown"},
        {"image_preset_id": "emoji-retired-v1"},
        {"image_preset_id": "emoji-phone-v1", "image_file_id": fid},
    ):
        assert c.patch(path, headers={**h, "If-Match": '"2"'}, json=values).status_code == 422
    assert c.get(path, headers=h).json()["revision"] == 2
    with Session(engine) as db, db.begin():
        with pytest.raises(IntegrityError), db.begin_nested():
            stored = db.get(Item, item["id"])
            stored.image_file_id = fid
            db.flush()
    r = c.post(path + "/update", headers={**h, "If-Match": '"2"'}, json={"image_file_id": fid})
    assert r.status_code == 200 and r.json()["image_preset_id"] is None
    r = c.patch(
        path,
        headers={**h, "If-Match": '"3"'},
        json={"image_file_id": None, "image_preset_id": None},
    )
    assert r.status_code == 200 and r.json()["image_file_id"] is None


def test_disabled_presets_still_render_and_allow_existing_item_edits(environment):
    c, engine, _, _ = environment
    seed_presets(engine)
    h, space, _ = authenticate(c)
    item = create(c, h, space, image_preset_id="emoji-phone-v1", key="one")
    path = f"/api/v1/items/{item['id']}"
    with Session(engine) as db, db.begin():
        db.get(ImagePreset, "emoji-phone-v1").enabled = False
    assert c.get("/api/v1/image-presets/emoji-phone-v1/access", headers=h).status_code == 200
    assert (
        c.get("/api/v1/image-presets/emoji-phone-v1/access?size=original", headers=h)
        .json()["url"]
        .endswith("original.png")
    )
    assert (
        c.patch(path, headers={**h, "If-Match": '"1"'}, json={"note": "still usable"}).status_code
        == 200
    )
    assert create(c, h, space, image_preset_id="emoji-phone-v1", key="one") == item
    assert (
        c.post(
            f"/api/v1/spaces/{space}/items",
            headers={**h, "Idempotency-Key": "new"},
            json={"name": "New", "image_preset_id": "emoji-phone-v1"},
        ).status_code
        == 422
    )
    assert c.delete(path, headers={**h, "If-Match": '"2"'}).status_code == 204
    assert (
        c.post(
            path + "/restore", headers={**h, "If-Match": '"3"', "Idempotency-Key": "restore"}
        ).status_code
        == 200
    )


def test_old_create_idempotency_receipts_still_replay_after_new_field(environment):
    c, engine, _, _ = environment
    h, space, login = authenticate(c)
    item = create(c, h, space, name="Old", key="pre-presets")
    payload = ItemCreate(name="Old").model_dump(mode="json", exclude={"image_preset_id"})
    with Session(engine) as db, db.begin():
        receipt = db.get(Idempotency, (login["user"]["id"], f"create:{space}", "pre-presets"))
        receipt.response = {k: v for k, v in receipt.response.items() if k != "image_preset_id"}
        receipt.fingerprint = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
    assert create(c, h, space, name="Old", key="pre-presets") == item


def test_import_preset_review_refresh_commit_and_disabled_validation(environment):
    c, engine, settings, storage, h, space, _, task, _ = setup(environment)
    seed_presets(engine)
    process(engine, settings, storage, claim(engine, settings), lambda *_: detected())
    task = get(c, h, task)
    entry = task["entries"][0]
    assert patch(c, h, task, entry, {"values": {"image_preset_id": "missing"}}).status_code == 422
    result = patch(
        c, h, task, entry, {"values": {"image_preset_id": "realistic-phone-v1"}, "confirmed": True}
    )
    assert result.status_code == 200
    task = get(c, h, task)
    assert task["entries"][0]["values"]["image_preset_id"] == "realistic-phone-v1"
    assert task["entries"][0]["values"]["image_file_id"] is None
    # Availability is checked again at commit, not just when the user opens the picker.
    with Session(engine) as db, db.begin():
        db.get(ImagePreset, "realistic-phone-v1").enabled = False
    assert submit(c, h, task).json()["results"][0]["status"] == "failed"
    with Session(engine) as db, db.begin():
        db.get(ImagePreset, "realistic-phone-v1").enabled = True
    response = submit(c, h, task, key="preset-save")
    assert response.json()["results"][0]["status"] == "saved"
    assert submit(c, h, task, key="preset-save").json() == response.json()
    saved = c.get(f"/api/v1/items/{response.json()['results'][0]['item_id']}", headers=h).json()
    assert saved["image_preset_id"] == "realistic-phone-v1" and saved["image_file_id"] is None
    assert len(storage.completed) == 1  # Only the original screenshot was uploaded.
