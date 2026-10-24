from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.schemas import Input

Nickname = Annotated[str, Field(min_length=1, max_length=100)]


class FamilyCreate(Input):
    name: Nickname
    nickname: Nickname


class NicknameInput(Input):
    nickname: Nickname


class RoleInput(Input):
    role: Literal["editor", "viewer"] = "editor"


class TransferInput(Input):
    target_space_id: str


class MemberOut(BaseModel):
    id: str
    user_id: str
    display_name: str
    role: Literal["admin", "editor", "viewer"]
    revision: int
    avatar_file_id: str | None = None


class InvitationOut(BaseModel):
    id: str
    token: str | None
    role: Literal["editor", "viewer"]
    status: Literal["active", "expired", "revoked", "unavailable"]
    created_at: datetime
    expires_at: datetime
    accepted_count: int


class InvitationPreview(BaseModel):
    family_name: str
    inviter_name: str
    role: Literal["editor", "viewer"]
    status: Literal["active", "expired", "revoked", "unavailable", "new_invitation_required"]
    expires_at: datetime
    already_member: bool


class MiniCodeOut(BaseModel):
    image_base64: str
    content_type: Literal["image/png"] = "image/png"
    expires_at: datetime
