"""Validate and publish shared artwork. Dry run by default; --publish writes COS and DB."""

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from PIL import Image
from qcloud_cos.cos_exception import CosServiceError
from sqlalchemy.orm import Session

from app.config import Settings
from app.db import make_engine
from app.models import ImagePreset
from app.security import advisory_lock
from app.storage import CosStorage


@dataclass
class Asset:
    key: str
    data: bytes
    sha256: str


@dataclass
class Preset:
    id: str
    name: str
    style: str
    version: int
    sort_order: int
    original: Asset
    preview: Asset

    def row(self):
        return {
            "id": self.id,
            "name": self.name,
            "style": self.style,
            "version": self.version,
            "sort_order": self.sort_order,
            "object_key": self.original.key,
            "preview_object_key": self.preview.key,
        }


def read_asset(root, filename, prefix, preset_id, kind, expected_size=None):
    root = root.resolve()
    path = (root / filename).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Asset path must stay inside its directory")
    data = path.read_bytes()
    with Image.open(BytesIO(data)) as image:
        image.load()
        if image.format != "PNG" or image.mode != "RGBA" or image.width != image.height:
            raise ValueError(f"{preset_id}: expected a square RGBA PNG")
        if expected_size and image.size != expected_size:
            raise ValueError(f"{preset_id}: unexpected preview dimensions")
        if image.getchannel("A").getextrema() != (0, 255):
            raise ValueError(f"{preset_id}: image must contain transparent and opaque pixels")
    digest = hashlib.sha256(data).hexdigest()
    return Asset(
        f"{prefix.rstrip('/')}/image-presets/{preset_id}/{kind}-{digest}.png", data, digest
    )


def prepare(assets, previews, prefix):
    manifest = json.loads((assets / "manifest.json").read_text())
    result = []
    ids = set()
    for index, entry in enumerate(manifest):
        preset_id = entry["preset_id"]
        match = re.fullmatch(r"[a-z][a-z0-9-]{0,70}-v([1-9][0-9]*)", preset_id)
        if not match or len(preset_id) > 80 or preset_id in ids:
            raise ValueError("Each preset needs a unique, versioned stable ID")
        if entry["style"] not in ("cartoon", "realistic"):
            raise ValueError("Unknown preset style")
        if not entry["name"].strip() or len(entry["name"]) > 100:
            raise ValueError("Invalid preset name")
        ids.add(preset_id)
        result.append(
            Preset(
                id=preset_id,
                name=entry["name"],
                style=entry["style"],
                version=int(match.group(1)),
                sort_order=index,
                original=read_asset(assets, entry["filename"], prefix, preset_id, "original"),
                preview=read_asset(
                    previews,
                    f"{entry['style']}/{entry['id']}.png",
                    prefix,
                    preset_id,
                    "preview",
                    (256, 256),
                ),
            )
        )
    if not result:
        raise ValueError("Empty catalog")
    return result


def ensure_object(client, bucket, asset):
    """Content-addressed keys are immutable; never replace an unexpected remote object."""
    try:
        meta = client.head_object(Bucket=bucket, Key=asset.key)
    except CosServiceError as exc:
        if exc.get_status_code() != 404:
            raise
        client.put_object(
            Bucket=bucket,
            Key=asset.key,
            Body=asset.data,
            EnableMD5=True,
            ContentType="image/png",
            CacheControl="private, max-age=86400",
            Metadata={"x-cos-meta-sha256": asset.sha256, "x-cos-forbid-overwrite": "true"},
        )
        meta = client.head_object(Bucket=bucket, Key=asset.key)
        uploaded = True
    else:
        uploaded = False
    headers = {key.lower(): value for key, value in meta.items()}
    if (
        int(headers["content-length"]) != len(asset.data)
        or headers.get("x-cos-meta-sha256") != asset.sha256
        or headers.get("content-type") != "image/png"
    ):
        raise ValueError("Remote artwork metadata differs; refusing to publish")
    return uploaded


def publish(engine, client, bucket, presets):
    uploaded = 0
    with Session(engine) as db, db.begin():
        advisory_lock(db, "publish-image-presets")
        # Check every existing version before uploading anything.
        for preset in presets:
            existing = db.get(ImagePreset, preset.id)
            if existing and any(
                getattr(existing, field) != preset.row()[field]
                for field in ("style", "version", "object_key", "preview_object_key")
            ):
                raise ValueError(
                    f"{preset.id}: published artwork is immutable; use a new version/ID"
                )
        for preset in presets:
            for asset in (preset.original, preset.preview):
                uploaded += ensure_object(client, bucket, asset)
            existing = db.get(ImagePreset, preset.id)
            if existing:
                existing.name = preset.name
                existing.sort_order = preset.sort_order
                # Republishing must not accidentally re-enable a disabled preset.
            else:
                db.add(ImagePreset(**preset.row(), enabled=True))
    return {"presets": len(presets), "uploaded": uploaded, "reused": len(presets) * 2 - uploaded}


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=Path, default=root / "output/image-presets")
    parser.add_argument("--previews", type=Path, default=root / "frontend/src/assets/presets")
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    settings = Settings()
    presets = prepare(args.assets, args.previews, settings.cos_key_prefix)
    report = {
        "mode": "publish" if args.publish else "dry-run",
        "presets": len(presets),
        "bytes": sum(len(p.original.data) + len(p.preview.data) for p in presets),
    }
    if args.publish:
        engine = make_engine(settings)
        try:
            report.update(
                publish(engine, CosStorage(settings).client, settings.cos_bucket, presets)
            )
        finally:
            engine.dispose()
    # No signed URLs or credentials in either console output or release record.
    if args.report:
        args.report.write_text(
            json.dumps(
                {**report, "catalog": [p.row() for p in presets]}, ensure_ascii=False, indent=2
            )
            + "\n"
        )
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # SDK/DB exceptions can include credential-bearing URLs; do not print them.
        print(
            f"Preset publication failed ({type(exc).__name__}); no catalog transaction committed."
        )
        raise SystemExit(1) from None
