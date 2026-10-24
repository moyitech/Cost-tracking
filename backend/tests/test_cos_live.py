"""Opt-in real COS direct-upload test. No production rows, no secrets printed."""

import os
import struct
import zlib

import httpx
import pytest
from sqlalchemy.orm import Session

from app.models import StoredFile
from app.storage import CosStorage
from tests.conftest import authenticate


def png_bytes():
    def chunk(kind, body):
        return (
            struct.pack("!I", len(body)) + kind + body + struct.pack("!I", zlib.crc32(kind + body))
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack("!2I5B", 16, 16, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress((b"\x00" + b"\xff\x00\x00" * 16) * 16))
        + chunk(b"IEND", b"")
    )


@pytest.mark.skipif(
    os.environ.get("COST_TRACKING_LIVE_COS") != "1", reason="real COS test is opt-in"
)
def test_real_direct_upload_complete_and_download(environment):
    client, engine, settings, _ = environment
    storage = CosStorage(settings)
    client.app.state.storage = storage
    h, space, _ = authenticate(client, "cos-live-check")
    image = png_bytes()
    keys = set()
    try:
        response = client.post(
            "/api/v1/files/uploads",
            headers=h,
            json={
                "space_id": space,
                "purpose": "item_image",
                "name": "connectivity-check.png",
                "mime_type": "image/png",
                "size_bytes": len(image),
            },
        )
        assert response.status_code == 201
        upload = response.json()
        with Session(engine) as db:
            file = db.get(StoredFile, upload["id"])
            keys.update([file.staging_key, file.object_key])
        with httpx.Client(timeout=30) as http:
            response = http.put(upload["url"], headers=upload["headers"], content=image)
            assert response.status_code == 200, f"COS PUT status={response.status_code}"
        response = client.post(f"/api/v1/files/{upload['id']}/complete", headers=h)
        # On failure final key change rolls back; enumerate only this test's uniquely-scoped directory for cleanup.
        prefix = f"{settings.cos_key_prefix.rstrip('/')}/files/{upload['id']}/"
        objects = storage.client.list_objects(Bucket=settings.cos_bucket, Prefix=prefix)
        keys.update(obj["Key"] for obj in objects.get("Contents", []))
        assert response.status_code == 200, response.json().get("error", {}).get("message")
        response = client.get(f"/api/v1/files/{upload['id']}/access", headers=h)
        assert response.status_code == 200
        with httpx.Client(timeout=30) as http:
            download = http.get(response.json()["url"])
            assert download.status_code == 200 and download.content == image
            # Reusing upload capability cannot mutate the finalized file.
            overwritten = http.put(upload["url"], headers=upload["headers"], content=b"invalid")
            assert overwritten.status_code == 200
            download = http.get(response.json()["url"])
            assert download.content == image
    finally:
        for key in keys:
            storage.client.delete_object(Bucket=settings.cos_bucket, Key=key)
