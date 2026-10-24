import json
from datetime import timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Query, Request, Response
from sqlalchemy import or_, select

from app import schemas as s
from app.avatars import authorize_upload, space_summary
from app.domain import aggregates, item_out
from app.errors import ApiError, invalid, not_found
from app.models import Event, Expense, Item, LoginSession, Member, Space, StoredFile, now, uid
from app.presets import image_patch
from app.security import DB, Auth, login, refresh, wechat_identity
from app.services import (
    authorize_space,
    authorized_item,
    file_allowed,
    finish_write,
    idempotent,
    paginate,
    record_event,
    require_revision,
    snapshot,
    sync_file_links,
    validate_timeline,
)

router = APIRouter(prefix="/api/v1")
Revision = Annotated[
    str | None, Header(alias="If-Match", description='当前资源版本，例如 "1"；写操作必填')
]
Idem = Annotated[
    str | None,
    Header(
        alias="Idempotency-Key",
        max_length=128,
        description="创建、追加费用和恢复必填；同一请求重试沿用原键",
    ),
]
Limit = Annotated[int, Query(ge=1, le=100)]
Cursor = Annotated[str | None, Query(max_length=4096)]


@router.post("/auth/wechat/login", response_model=s.TokenOut, tags=["auth"])
def wechat_login(body: s.WechatLogin, request: Request, db: DB):
    settings = request.app.state.settings
    return login(db, settings, wechat_identity(settings, body.code))


@router.post("/auth/refresh", response_model=s.TokenOut, tags=["auth"])
def refresh_login(body: s.RefreshInput, request: Request, db: DB):
    return refresh(db, request.app.state.settings, body.refresh_token)


@router.post("/auth/logout", status_code=204, tags=["auth"])
def logout(request: Request, db: DB, user: Auth):
    session = db.scalar(
        select(LoginSession).where(LoginSession.id == request.state.session_id).with_for_update()
    )
    session.revoked_at = now()


@router.get("/me", response_model=s.UserOut, tags=["auth"])
def me(user: Auth):
    return user


@router.get("/spaces", response_model=s.SpacesOut, tags=["spaces"])
def spaces(db: DB, user: Auth):
    rows = db.execute(
        select(Space, Member.role)
        .join(Member)
        .where(
            Member.user_id == user.id,
            or_(Space.kind == "family", Space.personal_owner_id == user.id),
        )
        .order_by(Space.id)
    )
    return {
        "items": [
            space_summary(db, space, role)
            for space, role in rows
        ]
    }


@router.post("/spaces/{space_id}/items", status_code=201, response_model=s.ItemOut, tags=["items"])
def create_item(
    space_id: str,
    body: s.ItemCreate,
    request: Request,
    db: DB,
    user: Auth,
    idempotency_key: Idem = None,
):
    authorize_space(db, user, space_id, write=True)

    def action():
        item = Item(space_id=space_id, **body.model_dump())
        db.add(item)
        validate_timeline(item, request.state.today)
        sync_file_links(db, user, item)
        record_event(db, user, item, "item_created", "创建物品档案", {}, item.purchase_date)
        return item_out(item, request.state.today)

    return idempotent(db, user, f"create:{space_id}", idempotency_key, body.model_dump(), action)


@router.get("/spaces/{space_id}/items", response_model=s.Page[s.ItemOut], tags=["items"])
def list_items(
    space_id: str,
    request: Request,
    db: DB,
    user: Auth,
    cursor: Cursor = None,
    limit: Limit = 20,
    q: Annotated[str | None, Query(max_length=200)] = None,
    status: Literal["active", "sold", "retired", "history"] | None = None,
):
    authorize_space(db, user, space_id)
    query = select(Item).where(Item.space_id == space_id, Item.deleted_at.is_(None))
    if q:
        query = query.where(Item.name.icontains(q, autoescape=True))
    if status:
        query = query.where(
            Item.status.in_(["sold", "retired"]) if status == "history" else Item.status == status
        )
    scope = json.dumps([user.id, space_id, q, status])
    rows, next_cursor = paginate(db, query, Item, limit, cursor, scope, request.app.state.settings)
    return {
        "items": [item_out(row, request.state.today) for row in rows],
        "next_cursor": next_cursor,
    }


@router.get("/items/{item_id}", response_model=s.ItemOut, tags=["items"])
def get_item(item_id: str, request: Request, db: DB, user: Auth):
    return item_out(authorized_item(db, user, item_id), request.state.today)


@router.post("/items/{item_id}/update", response_model=s.ItemOut, tags=["items"])
@router.patch("/items/{item_id}", response_model=s.ItemOut, tags=["items"])
def patch_item(
    item_id: str, body: s.ItemPatch, request: Request, db: DB, user: Auth, if_match: Revision = None
):
    item = authorized_item(db, user, item_id, write=True)
    require_revision(item, if_match)
    before = snapshot(item)
    for field, value in image_patch(body.model_dump(exclude_unset=True)).items():
        setattr(item, field, value)
    return finish_write(db, user, item, before, "item_updated", "编辑物品资料", request.state.today)


@router.post("/items/{item_id}/expenses", response_model=s.ItemOut, tags=["expenses"])
def create_expense(
    item_id: str,
    body: s.ExpenseCreate,
    request: Request,
    db: DB,
    user: Auth,
    if_match: Revision = None,
    idempotency_key: Idem = None,
):
    item = authorized_item(db, user, item_id, write=True, deleted=True)

    def action():
        if item.deleted_at:
            not_found()
        require_revision(item, if_match)
        before = snapshot(item)
        item.expenses.append(Expense(**body.model_dump()))
        return finish_write(
            db,
            user,
            item,
            before,
            "expense_created",
            "追加支出",
            request.state.today,
            body.occurred_on,
        )

    return idempotent(
        db,
        user,
        f"expense:{item_id}",
        idempotency_key,
        {"body": body.model_dump(), "revision": if_match},
        action,
    )


@router.post(
    "/items/{item_id}/expenses/{expense_id}/update", response_model=s.ItemOut, tags=["expenses"]
)
@router.patch("/items/{item_id}/expenses/{expense_id}", response_model=s.ItemOut, tags=["expenses"])
def patch_expense(
    item_id: str,
    expense_id: str,
    body: s.ExpensePatch,
    request: Request,
    db: DB,
    user: Auth,
    if_match: Revision = None,
):
    item = authorized_item(db, user, item_id, write=True)
    require_revision(item, if_match)
    expense = next((expense for expense in item.expenses if expense.id == expense_id), None)
    if not expense:
        not_found()
    before = snapshot(item)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(expense, field, value)
    return finish_write(
        db,
        user,
        item,
        before,
        "expense_updated",
        "更正支出",
        request.state.today,
        expense.occurred_on,
    )


@router.put("/items/{item_id}/disposal", response_model=s.ItemOut, tags=["items"])
def disposal(
    item_id: str, body: s.Disposal, request: Request, db: DB, user: Auth, if_match: Revision = None
):
    item = authorized_item(db, user, item_id, write=True)
    require_revision(item, if_match)
    before = snapshot(item)
    for field, value in body.model_dump(exclude={"confirmed_zero"}).items():
        setattr(item, field, value)
    return finish_write(
        db,
        user,
        item,
        before,
        "item_disposed",
        "登记或更正处置",
        request.state.today,
        body.disposal_date,
    )


@router.delete("/items/{item_id}", status_code=204, tags=["items"])
def delete_item(item_id: str, request: Request, db: DB, user: Auth, if_match: Revision = None):
    item = authorized_item(db, user, item_id, write=True, deleted=True)
    require_revision(item, if_match)
    if item.deleted_at:
        return Response(status_code=204)
    before = snapshot(item)
    item.deleted_at = now()
    finish_write(db, user, item, before, "item_deleted", "移入回收站", request.state.today)
    return Response(status_code=204)


@router.get("/spaces/{space_id}/trash", response_model=s.Page[s.ItemOut], tags=["items"])
def trash(
    space_id: str, request: Request, db: DB, user: Auth, cursor: Cursor = None, limit: Limit = 20
):
    authorize_space(db, user, space_id)
    rows, next_cursor = paginate(
        db,
        select(Item).where(Item.space_id == space_id, Item.deleted_at.is_not(None)),
        Item,
        limit,
        cursor,
        f"trash:{user.id}:{space_id}",
        request.app.state.settings,
    )
    return {
        "items": [item_out(row, request.state.today) for row in rows],
        "next_cursor": next_cursor,
    }


@router.post("/items/{item_id}/restore", response_model=s.ItemOut, tags=["items"])
def restore(
    item_id: str,
    request: Request,
    db: DB,
    user: Auth,
    if_match: Revision = None,
    idempotency_key: Idem = None,
):
    item = authorized_item(db, user, item_id, write=True, deleted=True)

    def action():
        require_revision(item, if_match)
        if not item.deleted_at:
            return item_out(item, request.state.today)
        before = snapshot(item)
        item.deleted_at = None
        return finish_write(
            db, user, item, before, "item_restored", "恢复物品档案", request.state.today
        )

    return idempotent(
        db, user, f"restore:{item_id}", idempotency_key, {"revision": if_match}, action
    )


def space_aggregates(space_id, request, db, user):
    authorize_space(db, user, space_id)
    items = list(
        db.scalars(select(Item).where(Item.space_id == space_id, Item.deleted_at.is_(None)))
    )
    return aggregates(items, request.state.today)


@router.get("/spaces/{space_id}/summary", response_model=s.SummaryOut, tags=["analytics"])
def summary(space_id: str, request: Request, db: DB, user: Auth):
    return space_aggregates(space_id, request, db, user)[0]


@router.get("/spaces/{space_id}/analytics", response_model=s.AnalyticsOut, tags=["analytics"])
def analytics(space_id: str, request: Request, db: DB, user: Auth):
    return space_aggregates(space_id, request, db, user)[1]


@router.get("/items/{item_id}/events", response_model=s.Page[s.EventOut], tags=["events"])
def item_events(
    item_id: str, request: Request, db: DB, user: Auth, cursor: Cursor = None, limit: Limit = 20
):
    authorized_item(db, user, item_id, deleted=True)
    rows, next_cursor = paginate(
        db,
        select(Event).where(Event.item_id == item_id, Event.type != "item_updated"),
        Event,
        limit,
        cursor,
        f"item-events:{user.id}:{item_id}",
        request.app.state.settings,
        event_dates=True,
    )
    return {"items": rows, "next_cursor": next_cursor}


@router.get("/spaces/{space_id}/events", response_model=s.Page[s.EventOut], tags=["events"])
def space_events(
    space_id: str, request: Request, db: DB, user: Auth, cursor: Cursor = None, limit: Limit = 20
):
    authorize_space(db, user, space_id)
    # Item history follows its current space, even after a future transfer.
    query = (
        select(Event)
        .where(Event.type != "item_updated")
        .outerjoin(Item, Event.item_id == Item.id)
        .where(
            or_(Item.space_id == space_id, (Event.item_id.is_(None)) & (Event.space_id == space_id))
        )
    )
    rows, next_cursor = paginate(
        db,
        query,
        Event,
        limit,
        cursor,
        f"space-events:{user.id}:{space_id}",
        request.app.state.settings,
    )
    return {"items": rows, "next_cursor": next_cursor}


@router.post("/files/uploads", response_model=s.UploadOut, status_code=201, tags=["files"])
def upload_intent(body: s.UploadIntent, request: Request, db: DB, user: Auth):
    authorize_upload(db, user, body.space_id, body.purpose)
    settings = request.app.state.settings
    if body.size_bytes > settings.upload_max_bytes:
        raise ApiError(413, "FILE_TOO_LARGE", "图片超过上传大小限制")
    if body.mime_type not in settings.upload_allowed_mime_types:
        invalid("mime_type", "不支持此图片格式")
    file_id = uid()
    prefix = settings.cos_key_prefix.rstrip("/")
    file = StoredFile(
        id=file_id,
        uploader_id=user.id,
        **body.model_dump(),
        staging_key=f"{prefix}/uploads/{file_id}",
        object_key=f"{prefix}/files/{file_id}",
    )
    db.add(file)
    db.flush()
    return {
        "id": file.id,
        "url": request.app.state.storage.upload_url(file),
        "method": "PUT",
        "headers": {"Content-Type": file.mime_type},
        "expires_at": now() + timedelta(seconds=settings.cos_signed_url_ttl_seconds),
    }


@router.post("/files/{file_id}/complete", response_model=s.FileOut, tags=["files"])
def complete_upload(file_id: str, request: Request, db: DB, user: Auth):
    file = db.scalar(select(StoredFile).where(StoredFile.id == file_id).with_for_update())
    if not file or file.uploader_id != user.id:
        not_found()
    authorize_upload(db, user, file.space_id, file.purpose)
    if file.state != "ready":
        # Every attempt uses a fresh destination so failed/retried completion never overwrites a ready object.
        file.object_key = (
            f"{request.app.state.settings.cos_key_prefix.rstrip('/')}/files/{file.id}/{uid()}"
        )
        request.app.state.storage.complete(file)
        file.state = "ready"
    return file


@router.get("/files/{file_id}/access", response_model=s.FileAccess, tags=["files"])
def file_access(file_id: str, request: Request, db: DB, user: Auth):
    file = db.get(StoredFile, file_id)
    file_allowed(db, user, file)
    return {
        "url": request.app.state.storage.access_url(file),
        "expires_at": now()
        + timedelta(seconds=request.app.state.settings.cos_signed_url_ttl_seconds),
    }
