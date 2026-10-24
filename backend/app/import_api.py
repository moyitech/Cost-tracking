from fastapi import APIRouter, Request, Response
from sqlalchemy import select

from app import import_schemas as s
from app.api import Idem, Revision
from app.errors import ApiError, not_found
from app.imports import (
    add_sources,
    capacity,
    commit_import,
    mutable,
    patch_entry,
    task_for,
    task_out,
)
from app.models import ImportEntry, ImportSource, ImportTask
from app.security import DB, Auth
from app.services import authorize_space, idempotent

router = APIRouter(prefix="/api/v1", tags=["imports"])


def available(request):
    config = request.app.state.settings
    if not config.ai_enabled or not config.ai_api_key.get_secret_value() or not config.ai_model:
        raise ApiError(503, "AI_UNAVAILABLE", "截图识别尚未开启，请使用手动建档")


@router.get("/spaces/{space_id}/imports", response_model=list[s.TaskOut])
def list_imports(space_id: str, db: DB, user: Auth):
    authorize_space(db, user, space_id)
    tasks = db.scalars(
        select(ImportTask)
        .where(
            ImportTask.space_id == space_id,
            ImportTask.user_id == user.id,
            ImportTask.canceled.is_(False),
        )
        .order_by(ImportTask.created_at.desc())
        .limit(20)
    )
    return [task_out(db, task) for task in tasks]


@router.post("/spaces/{space_id}/imports", status_code=202, response_model=s.TaskOut)
def create_import(
    space_id: str,
    body: s.SourceInput,
    request: Request,
    db: DB,
    user: Auth,
    idempotency_key: Idem = None,
):
    authorize_space(db, user, space_id, write=True)
    available(request)

    def action():
        task = ImportTask(user_id=user.id, space_id=space_id)
        db.add(task)
        db.flush()
        add_sources(db, user, task, body.source_file_ids, request.app.state.settings)
        return task_out(db, task)

    return idempotent(
        db,
        user,
        f"import-create:{space_id}",
        idempotency_key,
        body.model_dump(),
        action,
        item_result=False,
    )


@router.get("/imports/{task_id}", response_model=s.TaskOut)
def get_import(task_id: str, db: DB, user: Auth):
    return task_out(db, task_for(db, user, task_id))


def fixed_batch():
    raise ApiError(
        409, "IMPORT_STATE_CONFLICT", "整批识别的截图不能单独修改，请重新选择截图创建新批次"
    )


@router.post("/imports/{task_id}/sources", deprecated=True, response_model=s.TaskOut)
def append_sources(task_id: str, body: s.SourceInput, db: DB, user: Auth):
    task_for(db, user, task_id, write=True)
    fixed_batch()


@router.delete("/imports/{task_id}/sources/{source_id}", deprecated=True, response_model=s.TaskOut)
def remove_source(task_id: str, source_id: str, db: DB, user: Auth):
    task_for(db, user, task_id, write=True)
    fixed_batch()


@router.post("/imports/{task_id}/retry", status_code=202, response_model=s.TaskOut)
def retry_batch(
    task_id: str,
    body: s.RetryInput,
    request: Request,
    db: DB,
    user: Auth,
    idempotency_key: Idem = None,
):
    task = task_for(db, user, task_id, write=True)
    available(request)
    if "sources" in body.model_fields_set:
        fixed_batch()

    def action():
        mutable(task)
        sources = list(
            db.scalars(
                select(ImportSource).where(
                    ImportSource.task_id == task_id, ImportSource.removed.is_(False)
                )
            )
        )
        if not sources or any(source.status != "failed" for source in sources):
            raise ApiError(409, "IMPORT_STATE_CONFLICT", "只能重试整批失败的任务")
        entries = list(db.scalars(select(ImportEntry).where(ImportEntry.task_id == task_id)))
        if any(e.saved_item_id or e.overrides or e.input_mode == "manual" for e in entries):
            raise ApiError(409, "IMPORT_STATE_CONFLICT", "本批已有填写或保存内容，请新建批次")
        capacity(db, user, request.app.state.settings, len(sources))
        for source in sources:
            source.status = "queued"
            source.error = None
            source.generation += 1
            source.lease_until = None
        for entry in entries:
            db.delete(entry)
        db.flush()
        return task_out(db, task)

    return idempotent(
        db,
        user,
        f"import-retry:{task_id}",
        idempotency_key,
        {},
        action,
        item_result=False,
    )


@router.post("/imports/{task_id}/entries/{entry_id}/update", response_model=s.EntryOut)
@router.patch("/imports/{task_id}/entries/{entry_id}", response_model=s.EntryOut)
def update_entry(
    task_id: str, entry_id: str, body: s.EntryPatch, db: DB, user: Auth, if_match: Revision = None
):
    task = task_for(db, user, task_id, write=True)
    entry = db.get(ImportEntry, entry_id)
    if not entry or entry.task_id != task_id:
        not_found()
    return patch_entry(db, user, task, entry, body, if_match)


@router.post("/imports/{task_id}/commit", response_model=s.CommitOut)
def commit(
    task_id: str, body: s.CommitInput, request: Request, user: Auth, idempotency_key: Idem = None
):
    return commit_import(
        request.app.state.engine, user.id, task_id, body, idempotency_key, request.state.today
    )


@router.delete("/imports/{task_id}", status_code=204)
def cancel_import(task_id: str, db: DB, user: Auth):
    task = task_for(db, user, task_id, write=True)
    task.canceled = True
    for source in db.scalars(select(ImportSource).where(ImportSource.task_id == task_id)):
        source.generation += 1
    return Response(status_code=204)
