"""Avatars remain private: personal owners and current family members can read them."""

from fastapi import APIRouter
from sqlalchemy import func, select

from app.errors import ApiError, invalid, not_found
from app.models import Item, Member, Space, StoredFile, User
from app.schemas import AvatarInput, SpaceOut, UserOut
from app.security import DB, Auth, advisory_lock
from app.services import authorize_space

router = APIRouter(prefix="/api/v1", tags=["avatars"])


def authorize_upload(db, user, space_id, purpose):
    member = authorize_space(db, user, space_id, write=True)
    space = db.get(Space, space_id)
    if purpose == "personal_avatar" and (
        space.kind != "personal" or space.personal_owner_id != user.id
    ):
        invalid("space_id", "个人头像必须上传到自己的个人空间")
    if purpose == "family_avatar" and (space.kind != "family" or member.role != "admin"):
        raise ApiError(403, "PERMISSION_DENIED", "仅家庭管理者可以更换家庭头像")


def avatar_file(db, user, file_id, space_id, purpose):
    if file_id is None:
        return
    file = db.scalar(select(StoredFile).where(StoredFile.id == file_id).with_for_update())
    if not file or file.state != "ready" or file.uploader_id != user.id:
        not_found()
    if file.space_id != space_id or file.purpose != purpose:
        invalid("avatar_file_id", "请选择为当前头像上传的图片")


def space_summary(db, space, role):
    owner = db.get(User, space.personal_owner_id) if space.kind == "personal" else None
    return {
        "id": space.id, "name": space.name, "kind": space.kind, "role": role,
        "avatar_file_id": owner.avatar_file_id if owner else space.avatar_file_id,
        "member_count": db.scalar(
            select(func.count()).select_from(Member).where(Member.space_id == space.id)
        ),
        "item_count": db.scalar(
            select(func.count()).select_from(Item).where(
                Item.space_id == space.id, Item.deleted_at.is_(None)
            )
        ),
    }


@router.post("/me/avatar", response_model=UserOut)
def update_personal_avatar(body: AvatarInput, db: DB, user: Auth):
    space = db.scalar(select(Space).where(Space.personal_owner_id == user.id))
    authorize_upload(db, user, space.id, "personal_avatar")
    avatar_file(db, user, body.avatar_file_id, space.id, "personal_avatar")
    owner = db.scalar(select(User).where(User.id == user.id).with_for_update())
    owner.avatar_file_id = body.avatar_file_id
    return owner


@router.post("/spaces/{space_id}/avatar", response_model=SpaceOut)
def update_family_avatar(space_id: str, body: AvatarInput, db: DB, user: Auth):
    advisory_lock(db, "family:" + space_id)
    authorize_upload(db, user, space_id, "family_avatar")
    space = db.scalar(select(Space).where(Space.id == space_id).with_for_update())
    avatar_file(db, user, body.avatar_file_id, space.id, "family_avatar")
    space.avatar_file_id = body.avatar_file_id
    return space_summary(db, space, "admin")
