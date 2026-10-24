"""Import drafts and per-entry commit transactions, independent of provider work."""

from fastapi.encoders import jsonable_encoder
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import ApiError, invalid, not_found
from app.import_schemas import DraftValues
from app.models import (
    ImportEntry,
    ImportSource,
    ImportSubmission,
    ImportTask,
    Item,
    StoredFile,
    User,
)
from app.presets import image_patch, validate_image_reference
from app.schemas import ItemCreate
from app.security import advisory_lock
from app.services import (
    authorize_space,
    record_event,
    require_revision,
    sync_file_links,
    validate_timeline,
)


def task_for(db, user, task_id, write=False):
    task = db.scalar(select(ImportTask).where(ImportTask.id == task_id).with_for_update())
    if not task or task.user_id != user.id:
        not_found()
    authorize_space(db, user, task.space_id, write)
    return task


def mutable(task):
    if task.canceled:
        raise ApiError(409, "IMPORT_STATE_CONFLICT", "导入任务已取消")


def source_changes_allowed(db, task):
    mutable(task)
    if db.scalar(
        select(ImportEntry.id)
        .where(ImportEntry.task_id == task.id, ImportEntry.saved_item_id.is_not(None))
        .limit(1)
    ):
        raise ApiError(409, "IMPORT_STATE_CONFLICT", "已有条目建档，不能追加或移除来源")


def source_file(db, user, task, file_id):
    file = db.get(StoredFile, file_id)
    if (
        not file
        or file.uploader_id != user.id
        or file.space_id != task.space_id
        or file.state != "ready"
    ):
        not_found()
    if file.purpose != "import_source":
        invalid("source_file_ids", "请选择已完成上传的导入截图")
    return file


def capacity(db, user, settings, count):
    advisory_lock(db, "import-capacity:" + user.id)
    active = db.scalar(
        select(func.count())
        .select_from(ImportSource)
        .join(ImportTask)
        .where(
            ImportTask.user_id == user.id,
            ImportTask.canceled.is_(False),
            ImportSource.removed.is_(False),
            ImportSource.status.in_(["queued", "processing"]),
        )
    )
    if active + count > settings.ai_import_max_active_sources:
        raise ApiError(429, "RATE_LIMITED", "待识别图片较多，请等当前任务完成后再试")


def add_sources(db, user, task, ids, settings):
    source_changes_allowed(db, task)
    previous = list(db.scalars(select(ImportSource).where(ImportSource.task_id == task.id)))
    if len(ids) != len(set(ids)) or set(ids) & {s.file_id for s in previous}:
        invalid("source_file_ids", "同一批次不能重复添加同一文件")
    if len([s for s in previous if not s.removed]) + len(ids) > settings.ai_import_max_sources:
        invalid("source_file_ids", f"每批最多 {settings.ai_import_max_sources} 张截图")
    capacity(db, user, settings, len(ids))
    for fid in ids:
        source_file(db, user, task, fid)
        source = ImportSource(task_id=task.id, file_id=fid)
        db.add(source)
        db.flush()
    db.flush()


def values_for(entry):
    # Older tasks can still contain retired item attributes. Keep their stored
    # history, but expose and commit only the current writable fields.
    values = {**entry.recognized, **entry.overrides}
    return jsonable_encoder(
        DraftValues.model_validate(
            {k: v for k, v in values.items() if k in DraftValues.model_fields}
        )
    )


def duplicates(db, task, entry):
    values = values_for(entry)
    if not values.get("name"):
        return []
    rows = db.scalars(
        select(Item)
        .where(
            Item.space_id == task.space_id,
            Item.deleted_at.is_(None),
            func.lower(Item.name) == values["name"].strip().lower(),
        )
        .order_by(Item.id)
        .limit(20)
    )
    return [
        {"id": item.id, "name": item.name, "reason": "商品名相同，请判断是否为同一件实物"}
        for item in rows
        if item.id != entry.saved_item_id
    ]


def entry_out(db, task, entry):
    evidence = {
        k: v
        for k, v in entry.field_sources.items()
        if k in DraftValues.model_fields and k not in entry.overrides
    }
    evidence.update(
        {
            k: {"manual": True, "needs_review": False}
            for k in entry.overrides
            if k in DraftValues.model_fields
        }
    )
    return {
        "id": entry.id,
        "revision": entry.revision,
        "source_ids": entry.source_ids,
        "values": values_for(entry),
        "field_sources": evidence,
        "warnings": entry.warnings,
        "duplicate_candidates": duplicates(db, task, entry),
        **{
            k: getattr(entry, k)
            for k in (
                "duplicate_decision",
                "existing_item_id",
                "input_mode",
                "included",
                "confirmed",
                "saved_item_id",
            )
        },
    }


def task_out(db, task):
    sources = list(
        db.scalars(
            select(ImportSource)
            .where(ImportSource.task_id == task.id, ImportSource.removed.is_(False))
            .order_by(ImportSource.created_at, ImportSource.id)
        )
    )
    entries = list(
        db.scalars(
            select(ImportEntry)
            .where(ImportEntry.task_id == task.id)
            .order_by(ImportEntry.candidate_index, ImportEntry.id)
        )
    )
    states = {s.status for s in sources}
    status = (
        "canceled"
        if task.canceled
        else "processing"
        if "processing" in states
        else "queued"
        if "queued" in states
        else "partial_failed"
        if "failed" in states and "ready" in states
        else "failed"
        if "failed" in states
        else "ready"
    )
    return {
        "id": task.id,
        "space_id": task.space_id,
        "status": status,
        "sources": [
            {
                "id": s.id,
                "file_id": s.file_id,
                "name": db.get(StoredFile, s.file_id).name,
                "status": s.status,
                "attempts": s.attempts,
                "error": s.error,
                "retryable": s.status == "failed" and not task.canceled,
            }
            for s in sources
        ],
        "entries": [entry_out(db, task, e) for e in entries],
        "results": [e.last_result for e in entries if e.last_result],
        "poll_after_ms": 2000 if status in ("queued", "processing") else None,
    }


def patch_entry(db, user, task, entry, body, revision):
    mutable(task)
    if entry.saved_item_id:
        raise ApiError(409, "IMPORT_STATE_CONFLICT", "该条目已建档，请到物品详情编辑")
    require_revision(entry, revision)
    patch = body.model_dump(exclude_unset=True, mode="json")
    changes = patch.pop("values", None)
    if changes is not None:
        previous = values_for(entry)
        changes = image_patch(changes)
        merged = {**previous, **changes}
        validate_image_reference(
            db, merged.get("image_file_id"), merged.get("image_preset_id"),
            previous.get("image_preset_id"),
        )
        entry.overrides = {**entry.overrides, **changes}
    if changes or "input_mode" in patch:
        entry.confirmed = False
        entry.duplicate_decision = None
        entry.existing_item_id = None
    for field, value in patch.items():
        if value is None and field not in ("duplicate_decision", "existing_item_id"):
            invalid(field, "此字段不能为 null")
        setattr(entry, field, value)
    if entry.existing_item_id:
        if entry.existing_item_id not in {d["id"] for d in duplicates(db, task, entry)}:
            invalid("existing_item_id", "请选择当前空间的重复候选档案")
    entry.revision += 1
    entry.last_result = None
    db.flush()
    return entry_out(db, task, entry)


def commit_one(db, user, task, requested, today):
    entry = db.get(ImportEntry, requested.entry_id)
    if not entry or entry.task_id != task.id:
        not_found()
    if entry.saved_item_id:
        return {"entry_id": entry.id, "status": "already_saved", "item_id": entry.saved_item_id}
    mutable(task)
    require_revision(entry, f'"{requested.revision}"')
    if not entry.included:
        return {"entry_id": entry.id, "status": "skipped"}
    if not entry.confirmed:
        invalid("confirmed", "请先核对并确认本件")
    candidates = duplicates(db, task, entry)
    if entry.duplicate_decision == "skip_existing":
        if entry.existing_item_id not in {d["id"] for d in candidates}:
            invalid("existing_item_id", "重复档案已变化，请重新核对")
        return {"entry_id": entry.id, "status": "skipped", "item_id": entry.existing_item_id}
    if candidates and entry.duplicate_decision != "create_independent":
        invalid("duplicate_decision", "存在相同商品名，请明确跳过或独立建档")
    if entry.input_mode != "manual":
        sources = [db.get(ImportSource, sid) for sid in entry.source_ids]
        if not sources or any(not s or s.removed or s.status != "ready" for s in sources):
            invalid("source_ids", "来源尚未识别成功，请重试或转手动录入")
    try:
        values = ItemCreate.model_validate(values_for(entry))
    except ValidationError:
        invalid("values", "请检查名称、金额及日期；未知金额和日期可留空")
    item = Item(space_id=task.space_id, **values.model_dump())
    db.add(item)
    validate_timeline(item, today)
    sync_file_links(db, user, item)
    record_event(db, user, item, "item_created", "从截图校对建立物品档案", {}, item.purchase_date)
    entry.saved_item_id = item.id
    entry.revision += 1
    return {"entry_id": entry.id, "status": "saved", "item_id": item.id}


def commit_import(engine, user_id, task_id, body, key, today):
    if not key or not key.strip() or len(key) > 128:
        invalid("Idempotency-Key", "请携带长度 1 至 128 的幂等键")
    if len({e.entry_id for e in body.entries}) != len(body.entries):
        invalid("entries", "提交条目不能重复")
    payload = body.model_dump(mode="json")
    # Persist the immutable request before committing entries. Concurrent same-key calls serialize
    # on the submission row; each item + entry link + audit commits in its own transaction.
    with Session(engine) as db, db.begin():
        user = db.get(User, user_id)
        task_for(db, user, task_id, write=True)
        advisory_lock(db, f"submission:{task_id}:{key}")
        sub = db.get(ImportSubmission, (task_id, key))
        if sub and sub.payload != payload:
            raise ApiError(409, "IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同请求")
        if not sub:
            db.add(ImportSubmission(task_id=task_id, key=key, payload=payload))
    with Session(engine) as outer, outer.begin():
        sub = outer.scalar(
            select(ImportSubmission)
            .where(ImportSubmission.task_id == task_id, ImportSubmission.key == key)
            .with_for_update()
        )
        if sub.response is not None:
            return sub.response
        results = []
        for requested in body.entries:
            with Session(engine) as db, db.begin():
                user = db.get(User, user_id)
                task = task_for(db, user, task_id, write=True)
                try:
                    with db.begin_nested():
                        result = commit_one(db, user, task, requested, today)
                        db.flush()
                except ApiError as exc:
                    result = {
                        "entry_id": requested.entry_id,
                        "status": "failed",
                        "error": {
                            "code": exc.code,
                            "message": exc.message,
                            "field_errors": exc.fields,
                        },
                    }
                entry = db.get(ImportEntry, requested.entry_id)
                if entry and entry.task_id == task.id:
                    entry.last_result = result
                results.append(result)
        sub.response = {"results": results}
        return sub.response
