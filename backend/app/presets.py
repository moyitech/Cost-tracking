from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Request
from sqlalchemy import select

from app.errors import invalid, not_found
from app.models import ImagePreset, now
from app.schemas import FileAccess, ImagePresetsOut
from app.security import DB, Auth

router = APIRouter(prefix="/api/v1/image-presets", tags=["image-presets"])


def image_patch(values):
    """An explicit source switch clears the previous source, including partial PATCHes."""
    result = dict(values)
    if result.get("image_preset_id") is not None:
        if result.get("image_file_id") is not None:
            invalid("image_preset_id", "预设与相册照片只能选择一种")
        result["image_file_id"] = None
    elif result.get("image_file_id") is not None:
        result["image_preset_id"] = None
    return result


def validate_image_reference(db, file_id, preset_id, previous_preset_id=None):
    if file_id is not None and preset_id is not None:
        invalid("image_preset_id", "预设与相册照片只能选择一种")
    if preset_id is None:
        return
    with db.no_autoflush:
        preset = db.scalar(
            select(ImagePreset).where(ImagePreset.id == preset_id).with_for_update(read=True)
        )
    if not preset or (not preset.enabled and preset_id != previous_preset_id):
        invalid("image_preset_id", "这张预设暂不可用，请重新选择", "PRESET_UNAVAILABLE")


@router.get("", response_model=ImagePresetsOut)
def list_presets(request: Request, db: DB, user: Auth):
    rows = db.scalars(
        select(ImagePreset)
        .where(ImagePreset.enabled.is_(True))
        .order_by(ImagePreset.sort_order, ImagePreset.id)
    )
    expires = now() + timedelta(seconds=request.app.state.settings.cos_signed_url_ttl_seconds)
    storage = request.app.state.storage
    return {
        "items": [
            {
                "id": row.id,
                "name": row.name,
                "style": row.style,
                "version": row.version,
                "url": storage.preset_url(row, "original"),
                "preview_url": storage.preset_url(row, "preview"),
                "expires_at": expires,
            }
            for row in rows
        ]
    }


@router.get("/{preset_id}/access", response_model=FileAccess)
def preset_access(
    preset_id: str,
    request: Request,
    db: DB,
    user: Auth,
    size: Literal["preview", "original"] = "preview",
):
    # Disabled catalog entries remain accessible for existing items and history.
    preset = db.get(ImagePreset, preset_id)
    if not preset:
        not_found()
    return {
        "url": request.app.state.storage.preset_url(preset, size),
        "expires_at": now()
        + timedelta(seconds=request.app.state.settings.cos_signed_url_ttl_seconds),
    }
