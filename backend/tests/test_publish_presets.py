import hashlib
from dataclasses import replace

import pytest
from qcloud_cos.cos_comm import mapped
from qcloud_cos.cos_exception import CosServiceError
from sqlalchemy.orm import Session

from app.models import ImagePreset
from app.publish_presets import Asset, Preset, ensure_object, publish


class MemoryCos:
    def __init__(self):
        self.objects = {}

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise CosServiceError("HEAD", {"code": "NoSuchKey"}, 404)
        return self.objects[Key]

    def put_object(self, Bucket, Key, Body, EnableMD5, **kwargs):
        assert Key not in self.objects and EnableMD5
        headers = {k.lower(): v for k, v in mapped(kwargs).items()}
        assert headers["x-cos-forbid-overwrite"] == "true"
        self.objects[Key] = {**headers, "content-length": str(len(Body))}


def test_publish_is_repeatable_and_never_replaces_existing_versions(environment):
    _, engine, _, _ = environment
    client = MemoryCos()
    original = Asset(
        "presets/test/original.png", b"original", hashlib.sha256(b"original").hexdigest()
    )
    preview = Asset("presets/test/preview.png", b"preview", hashlib.sha256(b"preview").hexdigest())
    preset = Preset("emoji-test-v1", "测试", "cartoon", 1, 0, original, preview)
    assert publish(engine, client, "bucket", [preset])["uploaded"] == 2
    with Session(engine) as db, db.begin():
        db.get(ImagePreset, preset.id).enabled = False
    assert publish(engine, client, "bucket", [preset])["reused"] == 2
    with Session(engine) as db:
        assert db.get(ImagePreset, preset.id).enabled is False
    with pytest.raises(ValueError, match="immutable"):
        publish(
            engine, client, "bucket", [replace(preset, original=replace(original, key="different"))]
        )
    assert len(client.objects) == 2
    client.objects[preview.key]["x-cos-meta-sha256"] = "unexpected"
    with pytest.raises(ValueError, match="refusing"):
        ensure_object(client, "bucket", preview)
    assert len(client.objects) == 2
