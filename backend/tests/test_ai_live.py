"""Opt-in integration: generated receipt -> real COS -> DeepSeek -> reviewed item.
Only synthetic data is sent. All test database rows and COS objects are isolated/cleaned.
"""

import io
import os

import httpx
import pytest
from PIL import Image, ImageDraw, ImageFont

from app.storage import CosStorage
from app.worker import claim, process
from tests.conftest import authenticate


@pytest.mark.skipif(os.environ.get("COST_TRACKING_LIVE_AI") != "1", reason="real AI test is opt-in")
@pytest.mark.parametrize("paid_label", ["Paid per unit", "Order total paid (only item)"])
def test_real_receipt_import(environment, paid_label):
    c, engine, settings, _ = environment
    assert settings.ai_enabled and settings.ai_thinking_enabled
    assert settings.ai_max_output_tokens is None
    storage = CosStorage(settings)
    c.app.state.storage = storage
    h, space, _ = authenticate(c, "synthetic-ai-check")
    image = Image.new("RGB", (1000, 600), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=30)
    lines = [
        "SYNTHETIC TEST RECEIPT - NOT A REAL PURCHASE",
        "Item: Test Camera",
        "Brand: Sample",
        "Model: TEST-01",
        "Quantity: 1",
        "Listed per unit: CNY 1299.00",
        f"{paid_label}: CNY 1080.00",
        "Purchase date: 2026-10-01",
    ]
    for i, text in enumerate(lines):
        draw.text((30, 30 + i * 70), text, fill="black", font=font)
    out = io.BytesIO()
    image.save(out, format="PNG")
    blob = out.getvalue()
    response = c.post(
        "/api/v1/files/uploads",
        headers=h,
        json={
            "space_id": space,
            "purpose": "import_source",
            "name": "synthetic-receipt.png",
            "mime_type": "image/png",
            "size_bytes": len(blob),
        },
    )
    assert response.status_code == 201
    upload = response.json()
    prefix = f"{settings.cos_key_prefix.rstrip('/')}/files/{upload['id']}/"
    try:
        with httpx.Client(timeout=30) as http:
            assert (
                http.put(upload["url"], headers=upload["headers"], content=blob).status_code == 200
            )
        assert c.post(f"/api/v1/files/{upload['id']}/complete", headers=h).status_code == 200
        response = c.post(
            f"/api/v1/spaces/{space}/imports",
            headers={**h, "Idempotency-Key": "live"},
            json={"source_file_ids": [upload["id"]]},
        )
        assert response.status_code == 202
        task = response.json()
        process(engine, settings, storage, claim(engine, settings))
        task = c.get(f"/api/v1/imports/{task['id']}", headers=h).json()
        assert task["status"] == "ready", task["sources"][0]["error"]
        assert len(task["entries"]) == 1
        entry = task["entries"][0]
        assert "TEST-01" in entry["values"]["name"]
        assert entry["values"]["purchase_amount_cents"] == 108000
        assert entry["values"]["purchase_date"] == "2026-10-01"
        assert not entry["confirmed"]
        response = c.patch(
            f"/api/v1/imports/{task['id']}/entries/{entry['id']}",
            headers={**h, "If-Match": f'"{entry["revision"]}"'},
            json={"confirmed": True},
        )
        assert response.status_code == 200
        entry = response.json()
        body = {"entries": [{"entry_id": entry["id"], "revision": entry["revision"]}]}
        endpoint = f"/api/v1/imports/{task['id']}/commit"
        response = c.post(endpoint, headers={**h, "Idempotency-Key": "save"}, json=body)
        assert response.status_code == 200 and response.json()["results"][0]["status"] == "saved"
        replay = c.post(endpoint, headers={**h, "Idempotency-Key": "save"}, json=body)
        assert replay.json() == response.json()
    finally:
        objects = storage.client.list_objects(Bucket=settings.cos_bucket, Prefix=prefix)
        for obj in objects.get("Contents", []):
            storage.client.delete_object(Bucket=settings.cos_bucket, Key=obj["Key"])


@pytest.mark.skipif(os.environ.get("COST_TRACKING_LIVE_AI") != "1", reason="real AI test is opt-in")
def test_real_overlapping_batch(environment, monkeypatch):
    from app.ai import recognize
    from tests.batch_fixtures import shopping_screenshots

    c, engine, settings, _ = environment
    storage = CosStorage(settings)
    c.app.state.storage = storage
    h, space, _ = authenticate(c, "synthetic-batch-check")
    prefixes, ids, calls = [], [], []
    original_post = httpx.Client.post

    def capture(self, url, *args, **kwargs):
        if str(url) == settings.ai_base_url.rstrip("/") + "/chat/completions":
            calls.append(
                sum(p["type"] == "image_url" for p in kwargs["json"]["messages"][1]["content"])
            )
        return original_post(self, url, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "post", capture)
    try:
        for i, blob in enumerate(shopping_screenshots()):
            response = c.post(
                "/api/v1/files/uploads",
                headers=h,
                json={
                    "space_id": space,
                    "purpose": "import_source",
                    "name": f"synthetic-batch-{i}.png",
                    "mime_type": "image/png",
                    "size_bytes": len(blob),
                },
            )
            assert response.status_code == 201
            upload = response.json()
            prefixes.append(f"{settings.cos_key_prefix.rstrip('/')}/files/{upload['id']}/")
            with httpx.Client(timeout=30) as http:
                assert (
                    http.put(upload["url"], headers=upload["headers"], content=blob).status_code
                    == 200
                )
            assert c.post(f"/api/v1/files/{upload['id']}/complete", headers=h).status_code == 200
            ids.append(upload["id"])
        response = c.post(
            f"/api/v1/spaces/{space}/imports",
            headers={**h, "Idempotency-Key": "batch"},
            json={"source_file_ids": ids},
        )
        assert response.status_code == 202
        task = response.json()
        process(engine, settings, storage, claim(engine, settings), recognizer=recognize)
        task = c.get(f"/api/v1/imports/{task['id']}", headers=h).json()
        assert task["status"] == "ready", [s["error"] for s in task["sources"]]
        assert calls == [4]
        assert len(task["entries"]) == 3, [
            (e["values"]["name"], e["values"]["purchase_amount_cents"]) for e in task["entries"]
        ]
        assert sorted(e["values"]["purchase_amount_cents"] for e in task["entries"]) == [
            9900,
            108000,
            125000,
        ]
        assert sorted(e["values"]["purchase_date"] for e in task["entries"]) == [
            "2026-10-01",
            "2026-10-02",
            "2026-10-03",
        ]
        assert any(len(e["source_ids"]) >= 2 for e in task["entries"])
        assert c.get(f"/api/v1/spaces/{space}/items", headers=h).json()["items"] == []
    finally:
        for prefix in prefixes:
            objects = storage.client.list_objects(Bucket=settings.cos_bucket, Prefix=prefix)
            for obj in objects.get("Contents", []):
                storage.client.delete_object(Bucket=settings.cos_bucket, Key=obj["Key"])
