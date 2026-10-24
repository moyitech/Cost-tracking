import hashlib
import json
import re
from datetime import date, datetime

import jwt
from fastapi.encoders import jsonable_encoder
from sqlalchemy import case, delete, func, select, tuple_
from sqlalchemy.orm import aliased

from app.domain import item_out
from app.errors import ApiError, invalid, not_found
from app.models import Event, FileLink, Idempotency, Item, Member, Space, StoredFile, User
from app.presets import validate_image_reference
from app.schemas import RETIRED_ITEM_FIELDS, ItemCreate
from app.security import advisory_lock


def authorize_space(db, user, space_id, write=False):
    member = db.scalar(
        select(Member)
        .where(Member.space_id == space_id, Member.user_id == user.id)
        .with_for_update(read=True)
    )
    if not member:
        not_found()
    space = db.get(Space, space_id)
    if space.kind == "personal" and space.personal_owner_id != user.id:
        not_found()
    if write and member.role not in ("admin", "editor"):
        raise ApiError(403, "PERMISSION_DENIED", "当前空间仅有查看权限")
    return member


def authorized_item(db, user, item_id, write=False, deleted=False):
    item = db.scalar(
        select(Item).where(Item.id == item_id).with_for_update()
        if write
        else select(Item).where(Item.id == item_id)
    )
    if not item:
        not_found()
    authorize_space(db, user, item.space_id, write)
    if item.deleted_at and not deleted:
        not_found()
    return item


def require_revision(item, header):
    if header is None:
        raise ApiError(428, "PRECONDITION_REQUIRED", "请携带 If-Match 资源版本")
    if not re.fullmatch(r'"[1-9][0-9]*"', header):
        invalid("If-Match", '版本格式应为带引号的整数，例如 "1"')
    if int(header[1:-1]) != item.revision:
        raise ApiError(
            409,
            "REVISION_CONFLICT",
            "档案已更新，请刷新后核对再保存",
            details={"current_revision": item.revision},
        )


def idempotent(db, user, scope, key, payload, action, *, item_result=True):
    if not key or len(key) > 128 or not key.strip():
        invalid("Idempotency-Key", "请携带长度 1 至 128 的幂等键")
    fingerprint = hashlib.sha256(
        json.dumps(jsonable_encoder(payload), sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    advisory_lock(db, json.dumps([user.id, scope, key]))
    previous = db.get(Idempotency, (user.id, scope, key))
    if previous:
        legacy_fingerprint = None
        if scope.startswith("create:"):
            # A pre-upgrade create included retired default fields in its hash.
            # Reconstruct only those fields from the immutable original response;
            # changed names, prices, notes or attachments still conflict.
            legacy_payload = dict(payload)
            if RETIRED_ITEM_FIELDS <= previous.response.keys():
                legacy_payload.update({k: previous.response[k] for k in RETIRED_ITEM_FIELDS})
            if "image_preset_id" not in previous.response and payload.get("image_preset_id") is None:
                legacy_payload.pop("image_preset_id", None)
            legacy_fingerprint = hashlib.sha256(
                json.dumps(
                    jsonable_encoder(legacy_payload), sort_keys=True, separators=(",", ":")
                ).encode()
            ).hexdigest()
        if previous.fingerprint not in (fingerprint, legacy_fingerprint):
            raise ApiError(409, "IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同请求")
        if previous.item_id:
            authorized_item(db, user, previous.item_id, deleted=True)
        if item_result:
            return {k: v for k, v in previous.response.items() if k not in RETIRED_ITEM_FIELDS}
        if scope.startswith("import-"):
            return {
                **previous.response,
                "entries": [
                    {
                        **entry,
                        **{
                            field: {
                                k: v
                                for k, v in entry.get(field, {}).items()
                                if k not in RETIRED_ITEM_FIELDS
                            }
                            for field in ("values", "field_sources")
                        },
                    }
                    for entry in previous.response.get("entries", [])
                ],
            }
        return previous.response
    result = jsonable_encoder(action())
    db.add(
        Idempotency(
            user_id=user.id,
            scope=scope,
            key=key,
            fingerprint=fingerprint,
            response=result,
            item_id=result.get("id") if item_result else None,
        )
    )
    db.flush()
    return result


def validate_timeline(item, today):
    if item.purchase_date and item.purchase_date > today:
        invalid("purchase_date", "购买日期不能晚于今天", "FUTURE_DATE")
    if item.disposal_date:
        if item.disposal_date > today:
            invalid("disposal_date", "处置日期不能晚于今天", "FUTURE_DATE")
        if item.purchase_date and item.disposal_date < item.purchase_date:
            invalid("disposal_date", "处置日期不能早于购买日期")
    for expense in item.expenses:
        if expense.occurred_on > today:
            invalid("occurred_on", "支出日期不能晚于今天", "FUTURE_DATE")
        if item.purchase_date and expense.occurred_on < item.purchase_date:
            invalid("occurred_on", "支出日期不能早于购买日期")
        if item.disposal_date and expense.occurred_on > item.disposal_date:
            invalid("occurred_on", "支出日期不能晚于处置日期")


def file_allowed(db, user, file, space_id=None):
    if not file or file.state != "ready":
        not_found()
    if file.purpose in ("personal_avatar", "family_avatar"):
        if space_id is not None:
            invalid("image_file_id", "头像不能用作物品主图或凭证")
        if file.purpose == "personal_avatar":
            owner = db.scalar(select(User).where(User.avatar_file_id == file.id))
            if owner and owner.id != user.id:
                other = aliased(Member)
                shared = db.scalar(
                    select(Member.space_id)
                    .join(other, other.space_id == Member.space_id)
                    .join(Space, Space.id == Member.space_id)
                    .where(Member.user_id == user.id, other.user_id == owner.id,
                           Space.kind == "family")
                    .limit(1)
                )
                if shared:
                    authorize_space(db, user, shared)
                    return
        else:
            shared = db.scalar(select(Space).where(Space.avatar_file_id == file.id))
            if shared:
                authorize_space(db, user, shared.id)
                return
        if file.uploader_id != user.id:
            not_found()
        authorize_space(db, user, file.space_id)
        return
    linked_spaces = list(
        db.scalars(
            select(Item.space_id)
            .join(FileLink, FileLink.item_id == Item.id)
            .where(FileLink.file_id == file.id)
        )
    )
    if linked_spaces:
        for sid in set(linked_spaces):
            if space_id is not None and sid != space_id:
                continue
            member = db.scalar(
                select(Member).where(Member.user_id == user.id, Member.space_id == sid)
            )
            space = db.get(Space, sid)
            if member and (space.kind != "personal" or space.personal_owner_id == user.id):
                authorize_space(db, user, sid)
                return
        not_found()
    if file.uploader_id != user.id or (space_id is not None and file.space_id != space_id):
        not_found()
    authorize_space(db, user, file.space_id)


def sync_file_links(db, user, item, previous_preset_id=None):
    validate_image_reference(db, item.image_file_id, item.image_preset_id, previous_preset_id)
    ids = set(item.attachment_file_ids or [])
    if item.image_file_id:
        ids.add(item.image_file_id)
    for expense in item.expenses:
        ids.update(expense.attachment_file_ids or [])
    # Validate foreign keys before autoflush, so unknown/unauthorized IDs return 404,
    # not a database constraint error. No unvalidated association reaches storage.
    with db.no_autoflush:
        for file_id in sorted(ids):
            file = db.scalar(select(StoredFile).where(StoredFile.id == file_id).with_for_update())
            file_allowed(db, user, file, item.space_id)
            if file.purpose == "import_source":
                invalid("attachment_file_ids", "导入原图不能直接作为正式档案附件")
    db.flush()
    db.execute(delete(FileLink).where(FileLink.item_id == item.id))
    for file_id in sorted(ids):
        db.add(FileLink(file_id=file_id, item_id=item.id))


def snapshot(item):
    return jsonable_encoder(
        {
            **{field: getattr(item, field) for field in ItemCreate.model_fields},
            "status": item.status,
            "space_id": item.space_id,
            "disposal_date": item.disposal_date,
            "recovery_amount_cents": item.recovery_amount_cents,
            "deleted_at": item.deleted_at,
            "expenses": [
                {
                    "id": e.id,
                    "category": e.category,
                    "amount_cents": e.amount_cents,
                    "occurred_on": e.occurred_on,
                    "note": e.note,
                    "attachment_file_ids": e.attachment_file_ids,
                }
                for e in item.expenses
            ],
        }
    )


def record_event(db, user, item, event_type, title, before, occurred_on):
    member = db.scalar(select(Member).where(Member.space_id == item.space_id,
                       Member.user_id == user.id))
    actor_name = (member.nickname if member else None) or user.display_name
    after = snapshot(item)
    changes = [
        {"field": key, "before": before.get(key), "after": value}
        for key, value in after.items()
        if before.get(key) != value
    ]
    db.add(
        Event(
            item_id=item.id,
            space_id=item.space_id,
            type=event_type,
            title=title,
            occurred_on=occurred_on,
            actor={"id": user.id, "display_name": actor_name},
            changes=changes,
        )
    )


def finish_write(db, user, item, before, event_type, title, today, occurred_on=None):
    validate_timeline(item, today)
    sync_file_links(db, user, item, before.get("image_preset_id"))
    item.revision += 1
    db.flush()
    if event_type != "item_updated":
        record_event(db, user, item, event_type, title, before, occurred_on or today)
    return item_out(item, today)


def paginate(db, query, model, limit, cursor, scope, settings, event_dates=False, member_user_id=None):
    date_col = func.coalesce(Event.occurred_on, date.min) if event_dates else None
    columns = (
        [date_col, Event.recorded_at, Event.id]
        if event_dates
        else [model.recorded_at, model.id]
        if model is Event
        else [model.created_at, model.id]
    )
    # Rank the entire roster before keyset pagination, not just the fetched page.
    if member_user_id is not None:
        columns = [
            case((Member.role == "admin", 3), (Member.role == "editor", 2), else_=1),
            case((Member.user_id == member_user_id, 1), else_=0),
            Member.created_at,
            Member.id,
        ]
    if cursor:
        try:
            token = jwt.decode(cursor, settings.jwt_secret.get_secret_value(), algorithms=["HS256"])
            if token.get("kind") != "cursor" or token.get("scope") != scope:
                raise ValueError()
            values = token["values"]
            parsed = [] if member_user_id is not None else (
                [date.fromisoformat(values[0]), datetime.fromisoformat(values[1]), values[2]]
                if event_dates
                else [datetime.fromisoformat(values[0]), values[1]]
            )
            if member_user_id is not None:
                if len(values) != 4 or values[0] not in (1, 2, 3) or values[1] not in (0, 1):
                    raise ValueError()
                parsed = [values[0], values[1], datetime.fromisoformat(values[2]), values[3]]
            query = query.where(tuple_(*columns) < tuple_(*parsed))
        except (jwt.InvalidTokenError, ValueError, KeyError, IndexError, TypeError):
            invalid("cursor", "分页游标无效")
    rows = list(db.scalars(query.order_by(*(col.desc() for col in columns)).limit(limit + 1)))
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        values = (
            [str(last.occurred_on or date.min), last.recorded_at.isoformat(), last.id]
            if event_dates
            else [(last.recorded_at if model is Event else last.created_at).isoformat(), last.id]
        )
        if member_user_id is not None:
            values = [
                {"admin": 3, "editor": 2, "viewer": 1}[last.role],
                int(last.user_id == member_user_id), last.created_at.isoformat(), last.id,
            ]
        next_cursor = jwt.encode(
            {"kind": "cursor", "scope": scope, "values": values},
            settings.jwt_secret.get_secret_value(),
            algorithm="HS256",
        )
    return rows, next_cursor
