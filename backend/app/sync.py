"""Small, consistent manifest; data and media remain on their existing authorized APIs."""

import hashlib
import json
from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.security import Auth, DB

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])


class SpaceVersion(BaseModel):
    id: str
    version: str


class SyncManifest(BaseModel):
    profile_version: str
    presets_version: str
    preset_versions: dict[str, str]
    spaces: list[SpaceVersion]
    checked_at: datetime


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@router.get("/manifest", response_model=SyncManifest)
def manifest(db: DB, user: Auth):
    # One PostgreSQL statement sees a single MVCC snapshot, even at READ COMMITTED.
    row = db.execute(text("""
      SELECT json_build_array(u.id, u.display_name, u.avatar_file_id) AS profile,
        COALESCE((SELECT json_agg(json_build_object('id', s.id, 'version', s.sync_revision::text) ORDER BY s.id)
          FROM spaces s JOIN members m ON m.space_id = s.id
          WHERE m.user_id = u.id AND (s.kind = 'family' OR s.personal_owner_id = u.id)), '[]') AS spaces,
        COALESCE((SELECT json_agg(json_build_array(id, version, name, style, enabled,
          object_key, preview_object_key, sort_order) ORDER BY id) FROM image_presets), '[]') AS presets,
        statement_timestamp() AS checked_at
      FROM users u WHERE u.id = :user_id
    """), {"user_id": user.id}).mappings().one()
    return {"profile_version": digest(row["profile"]), "presets_version": digest(row["presets"]),
            "preset_versions": {p[0]: str(p[1]) for p in row["presets"]},
            "spaces": row["spaces"], "checked_at": row["checked_at"]}
