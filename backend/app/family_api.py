"""Family collaboration; all membership/invitation mutations serialize per family."""

import secrets
from datetime import timedelta

from fastapi import APIRouter, Request, Response
from sqlalchemy import func, select

from app import family_schemas as s
from app.api import Cursor, Idem, Limit, Revision
from app.domain import item_out
from app.errors import ApiError, invalid, not_found
from app.models import (
    Event,
    Invitation,
    InvitationAcceptance,
    Member,
    MemberRemoval,
    Space,
    User,
    now,
    uid,
)
from app.schemas import ItemOut, Page, SpaceOut
from app.security import DB, Auth, advisory_lock
from app.services import (
    authorize_space,
    authorized_item,
    idempotent,
    paginate,
    record_event,
    require_revision,
    snapshot,
)

router = APIRouter(prefix="/api/v1", tags=["families"])


def member_out(member, db=None):
    return {
        "id": member.id,
        "user_id": member.user_id,
        "display_name": member.nickname or "家庭成员",
        "role": member.role,
        "revision": member.revision,
        "avatar_file_id": db.get(User, member.user_id).avatar_file_id if db is not None else None,
    }


def space_out(space, member):
    return {"id": space.id, "name": space.name, "kind": space.kind, "role": member.role,
            "avatar_file_id": space.avatar_file_id}


def family(db, user, space_id, admin=False, mutation=False):
    if mutation:
        advisory_lock(db, "family:" + space_id)
    member = authorize_space(db, user, space_id)
    space = db.get(Space, space_id)
    if space.kind != "family":
        invalid("space_id", "此操作仅适用于家庭空间")
    if admin and member.role != "admin":
        raise ApiError(403, "PERMISSION_DENIED", "仅家庭管理者可以操作")
    return space, member


def event(db, user, member, space_id, kind, title, changes):
    db.add(
        Event(
            space_id=space_id,
            item_id=None,
            type=kind,
            title=title,
            actor={"id": user.id, "display_name": member.nickname or "家庭成员"},
            changes=changes,
        )
    )


@router.post("/spaces", response_model=SpaceOut, status_code=201)
def create_family(body: s.FamilyCreate, db: DB, user: Auth, idempotency_key: Idem = None):
    def action():
        space = Space(id=uid(), name=body.name, kind="family")
        db.add(space)
        db.flush()
        member = Member(space_id=space.id, user_id=user.id, role="admin", nickname=body.nickname)
        db.add(member)
        db.flush()
        event(
            db,
            user,
            member,
            space.id,
            "family_created",
            "创建家庭",
            [{"field": "name", "before": None, "after": space.name}],
        )
        return space_out(space, member)

    result = idempotent(
        db, user, "family-create", idempotency_key, body.model_dump(), action, item_result=False
    )
    space, member = family(db, user, result["id"])
    return space_out(space, member)


@router.get(
    "/spaces/{space_id}/members", response_model=Page[s.MemberOut],
    description="按管理者、编辑者、查看者排序，同角色本人优先，其余按加入时间倒序分页。",
)
def members(
    space_id: str, request: Request, db: DB, user: Auth, cursor: Cursor = None, limit: Limit = 20
):
    family(db, user, space_id)
    rows, next_cursor = paginate(
        db,
        select(Member).where(Member.space_id == space_id),
        Member,
        limit,
        cursor,
        f"members:role-v2:{user.id}:{space_id}",
        request.app.state.settings,
        member_user_id=user.id,
    )
    return {"items": [member_out(m, db) for m in rows], "next_cursor": next_cursor}


@router.get("/spaces/{space_id}/members/me", response_model=s.MemberOut)
def my_membership(space_id: str, db: DB, user: Auth):
    _, member = family(db, user, space_id)
    return member_out(member, db)


# Register /me before the parameterized member route.
@router.patch("/spaces/{space_id}/members/me", response_model=s.MemberOut)
@router.post("/spaces/{space_id}/members/me/update", response_model=s.MemberOut)
def nickname(space_id: str, body: s.NicknameInput, db: DB, user: Auth, if_match: Revision = None):
    _, member = family(db, user, space_id, mutation=True)
    require_revision(member, if_match)
    before = member.nickname
    event(
        db,
        user,
        member,
        space_id,
        "member_nickname",
        "修改家庭昵称",
        [
            {"field": "nickname", "before": before, "after": body.nickname},
            {"field": "user_id", "before": user.id, "after": user.id},
        ],
    )
    member.nickname = body.nickname
    member.revision += 1
    return member_out(member, db)


def other_member(db, space_id, user, member_id):
    target = db.scalar(
        select(Member).where(Member.id == member_id, Member.space_id == space_id).with_for_update()
    )
    if not target:
        not_found()
    if target.user_id == user.id or target.role == "admin":
        raise ApiError(403, "PERMISSION_DENIED", "不支持修改自己或管理者的角色及成员关系")
    return target


@router.patch("/spaces/{space_id}/members/{member_id}", response_model=s.MemberOut)
@router.post("/spaces/{space_id}/members/{member_id}/update", response_model=s.MemberOut)
def change_role(
    space_id: str, member_id: str, body: s.RoleInput, db: DB, user: Auth, if_match: Revision = None
):
    _, actor = family(db, user, space_id, admin=True, mutation=True)
    target = other_member(db, space_id, user, member_id)
    require_revision(target, if_match)
    before = member_out(target)
    target.role = body.role
    target.revision += 1
    event(
        db,
        user,
        actor,
        space_id,
        "member_role",
        "调整成员角色",
        [{"field": "member", "before": before, "after": member_out(target)}],
    )
    return member_out(target, db)


@router.delete("/spaces/{space_id}/members/{member_id}", status_code=204)
def remove_member(space_id: str, member_id: str, db: DB, user: Auth, if_match: Revision = None):
    _, actor = family(db, user, space_id, admin=True, mutation=True)
    target = other_member(db, space_id, user, member_id)
    require_revision(target, if_match)
    boundary = db.get(MemberRemoval, (space_id, target.user_id))
    if boundary:
        boundary.removed_at = now()
    else:
        db.add(MemberRemoval(space_id=space_id, user_id=target.user_id, removed_at=now()))
    event(
        db,
        user,
        actor,
        space_id,
        "member_removed",
        "移除家庭成员",
        [{"field": "member", "before": member_out(target), "after": None}],
    )
    db.delete(target)
    return Response(status_code=204)


def invite_state(db, invite, user=None):
    if invite.revoked_at:
        return "revoked"
    if invite.expires_at <= now():
        return "expired"
    inviter = db.scalar(
        select(Member).where(
            Member.space_id == invite.space_id, Member.user_id == invite.inviter_id
        )
    )
    if not inviter or inviter.role != "admin":
        return "unavailable"
    if user:
        removal = db.get(MemberRemoval, (invite.space_id, user.id))
        if removal and invite.created_at <= removal.removed_at:
            return "new_invitation_required"
    return "active"


def invite_out(db, invite):
    status = invite_state(db, invite)
    count = db.scalar(
        select(func.count())
        .select_from(InvitationAcceptance)
        .where(InvitationAcceptance.invitation_id == invite.id)
    )
    return {
        "id": invite.id,
        "token": invite.token if status == "active" else None,
        "role": invite.role,
        "status": status,
        "created_at": invite.created_at,
        "expires_at": invite.expires_at,
        "accepted_count": count,
    }


@router.post("/spaces/{space_id}/invitations", response_model=s.InvitationOut, status_code=201)
def invite(space_id: str, body: s.RoleInput, db: DB, user: Auth, idempotency_key: Idem = None):
    _, actor = family(db, user, space_id, admin=True, mutation=True)

    def action():
        created = now()
        invitation = Invitation(
            space_id=space_id,
            inviter_id=user.id,
            token=secrets.token_urlsafe(24),
            role=body.role,
            created_at=created,
            expires_at=created + timedelta(days=7),
        )
        db.add(invitation)
        db.flush()
        event(
            db,
            user,
            actor,
            space_id,
            "invitation_created",
            "生成家庭邀请",
            [{"field": "role", "before": None, "after": body.role}],
        )
        return {"id": invitation.id}

    result = idempotent(
        db,
        user,
        f"family-invite:{space_id}",
        idempotency_key,
        body.model_dump(),
        action,
        item_result=False,
    )
    return invite_out(db, db.get(Invitation, result["id"]))


@router.get("/spaces/{space_id}/invitations", response_model=Page[s.InvitationOut])
def invitations(
    space_id: str, request: Request, db: DB, user: Auth, cursor: Cursor = None, limit: Limit = 20
):
    family(db, user, space_id, admin=True)
    rows, next_cursor = paginate(
        db,
        select(Invitation).where(Invitation.space_id == space_id),
        Invitation,
        limit,
        cursor,
        f"invitations:{user.id}:{space_id}",
        request.app.state.settings,
    )
    return {"items": [invite_out(db, i) for i in rows], "next_cursor": next_cursor}


@router.delete("/spaces/{space_id}/invitations/{invitation_id}", status_code=204)
def revoke(space_id: str, invitation_id: str, db: DB, user: Auth):
    _, actor = family(db, user, space_id, admin=True, mutation=True)
    invite = db.get(Invitation, invitation_id)
    if not invite or invite.space_id != space_id:
        not_found()
    if not invite.revoked_at:
        invite.revoked_at = now()
        event(
            db,
            user,
            actor,
            space_id,
            "invitation_revoked",
            "撤销家庭邀请",
            [{"field": "invitation_id", "before": invitation_id, "after": None}],
        )
    return Response(status_code=204)


def by_token(db, token):
    invite = db.scalar(select(Invitation).where(Invitation.token == token))
    if not invite:
        not_found()
    return invite


@router.get("/invitations/{token}", response_model=s.InvitationPreview)
def preview(token: str, db: DB, user: Auth):
    invite = by_token(db, token)
    inviter = db.scalar(
        select(Member).where(
            Member.space_id == invite.space_id, Member.user_id == invite.inviter_id
        )
    )
    existing = db.scalar(
        select(Member).where(Member.space_id == invite.space_id, Member.user_id == user.id)
    )
    return {
        "family_name": db.get(Space, invite.space_id).name,
        "inviter_name": inviter.nickname or "家庭管理者" if inviter else "家庭管理者",
        "role": invite.role,
        "status": invite_state(db, invite, user),
        "expires_at": invite.expires_at,
        "already_member": existing is not None,
    }


@router.post("/invitations/{token}/accept", response_model=SpaceOut)
def accept(token: str, body: s.NicknameInput, db: DB, user: Auth, idempotency_key: Idem = None):
    invite = by_token(db, token)
    advisory_lock(db, "family:" + invite.space_id)
    db.refresh(invite)
    status = invite_state(db, invite, user)
    if status != "active":
        messages = {
            "expired": "邀请已过期",
            "revoked": "邀请已撤销",
            "unavailable": "邀请者已无管理权限",
            "new_invitation_required": "请管理者生成新邀请后重新加入",
        }
        raise ApiError(409, "INVITATION_" + status.upper(), messages[status])

    def action():
        member = db.scalar(
            select(Member).where(Member.space_id == invite.space_id, Member.user_id == user.id)
        )
        if not member:
            member = Member(
                space_id=invite.space_id, user_id=user.id, role=invite.role, nickname=body.nickname
            )
            db.add(member)
            db.flush()
            db.add(InvitationAcceptance(invitation_id=invite.id, user_id=user.id))
            event(
                db,
                user,
                member,
                invite.space_id,
                "member_joined",
                "加入家庭",
                [{"field": "member", "before": None, "after": member_out(member)}],
            )
        return {"id": invite.space_id}

    idempotent(
        db,
        user,
        f"family-accept:{invite.id}",
        idempotency_key,
        body.model_dump(),
        action,
        item_result=False,
    )
    member = authorize_space(db, user, invite.space_id)
    return space_out(db.get(Space, invite.space_id), member)


@router.post("/items/{item_id}/transfer", response_model=ItemOut)
def transfer(
    item_id: str,
    body: s.TransferInput,
    request: Request,
    db: DB,
    user: Auth,
    if_match: Revision = None,
    idempotency_key: Idem = None,
):
    # Lock the item before checking ownership, as other item writes do.
    item = authorized_item(db, user, item_id, write=True)
    target = db.get(Space, body.target_space_id)
    authorize_space(db, user, body.target_space_id, write=True)
    if not target or target.kind != "family":
        invalid("target_space_id", "目标必须是可编辑的家庭空间")

    def action():
        require_revision(item, if_match)
        source = db.get(Space, item.space_id)
        if source.kind != "personal" or source.personal_owner_id != user.id:
            invalid("target_space_id", "仅支持本人的个人物品迁入家庭")
        before = snapshot(item)
        item.space_id = target.id
        item.revision += 1
        # FileLink follows the item; do not rewrite StoredFile or shared file links.
        db.flush()
        record_event(
            db, user, item, "item_transferred", "迁入家庭空间", before, request.state.today
        )
        return item_out(item, request.state.today)

    return idempotent(
        db,
        user,
        f"transfer:{item_id}",
        idempotency_key,
        {**body.model_dump(), "revision": if_match},
        action,
    )


@router.post("/spaces/{space_id}/invitations/{invitation_id}/mini-code", response_model=s.MiniCodeOut)
def mini_code(space_id: str, invitation_id: str, request: Request, response: Response, db: DB, user: Auth):
    # Serialize with membership changes and revocation while generating the code.
    family(db, user, space_id, admin=True, mutation=True)
    invitation = db.get(Invitation, invitation_id)
    if not invitation or invitation.space_id != space_id:
        not_found()
    if invite_state(db, invitation) != "active":
        raise ApiError(409, "INVITATION_UNAVAILABLE", "邀请已失效，请重新生成邀请")
    image = request.app.state.wechat_codes.generate(invitation.token)
    if invite_state(db, invitation) != "active":
        raise ApiError(409, "INVITATION_UNAVAILABLE", "邀请已失效，请重新生成邀请")
    response.headers["Cache-Control"] = "no-store"
    return {"image_base64": image, "expires_at": invitation.expires_at}
