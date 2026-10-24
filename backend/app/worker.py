"""Durable PostgreSQL work queue, embedded in the API or run independently."""

import argparse
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.ai import recognize
from app.config import Settings
from app.db import make_engine
from app.errors import ApiError
from app.imports import source_file, task_for
from app.models import ImportEntry, ImportSource, ImportTask, User, now
from app.storage import CosStorage

logger = logging.getLogger("uvicorn.error.worker")


def sources_for(db, task_id):
    return list(
        db.scalars(
            select(ImportSource)
            .where(ImportSource.task_id == task_id, ImportSource.removed.is_(False))
            .order_by(ImportSource.created_at, ImportSource.id)
            .execution_options(populate_existing=True)
        )
    )


def claim(engine, settings):
    with Session(engine) as db, db.begin():
        eligible = select(ImportSource.task_id).where(
            ImportSource.removed.is_(False),
            or_(
                ImportSource.status == "queued",
                and_(ImportSource.status == "processing", ImportSource.lease_until < now()),
            ),
        )
        tasks = db.scalars(
            select(ImportTask)
            .where(ImportTask.canceled.is_(False), ImportTask.id.in_(eligible))
            .order_by(ImportTask.created_at)
            .with_for_update(skip_locked=True)
            .limit(100)
        )
        for task in tasks:
            sources = sources_for(db, task.id)
            if not sources or any(
                s.status not in ("queued", "processing")
                or (s.status == "processing" and s.lease_until and s.lease_until >= now())
                for s in sources
            ):
                continue
            lease = now() + timedelta(seconds=settings.ai_timeout_seconds + 60)
            for source in sources:
                source.status = "processing"
                source.generation += 1
                source.attempts += 1
                source.lease_until = lease
            # Snapshot the entire batch. No second worker can claim one of its pictures.
            return task.id, tuple((s.id, s.generation) for s in sources)
    return None


def current_job(task, sources, snapshot):
    return (
        bool(task and not task.canceled)
        and tuple((s.id, s.generation) for s in sources) == snapshot
        and all(s.status == "processing" for s in sources)
    )


def process(engine, settings, storage, job, recognizer=recognize):
    task_id, snapshot = job
    try:
        with Session(engine) as db, db.begin():
            task = db.get(ImportTask, task_id)
            if not task:
                return
            task = task_for(db, db.get(User, task.user_id), task_id, write=True)
            sources = sources_for(db, task_id)
            if not current_job(task, sources, snapshot):
                return
            # Sign all URLs immediately before the one provider request.
            urls = [
                storage.access_url(
                    source_file(db, db.get(User, task.user_id), task, source.file_id)
                )
                for source in sources
            ]
        result = recognizer(settings, urls)
        # Validate provenance before any source or entry is marked ready.
        for detected in result:
            indexes = detected["source_indexes"]
            if not indexes or any(
                type(i) is not int or not 1 <= i <= len(snapshot) for i in indexes
            ):
                raise ValueError("invalid batch provenance")
        error = None
    except ApiError as exc:
        result = None
        error = {"code": exc.code, "message": exc.message}
    except Exception as exc:
        logger.error("Recognition failed (%s)", type(exc).__name__)
        result = None
        error = {"code": "AI_RECOGNITION_FAILED", "message": "本批截图识别失败，请重试或手动添加"}
    with Session(engine) as db, db.begin():
        task = db.scalar(select(ImportTask).where(ImportTask.id == task_id).with_for_update())
        sources = sources_for(db, task_id)
        if not current_job(task, sources, snapshot):
            return
        try:
            with db.begin_nested():
                task_for(db, db.get(User, task.user_id), task_id, write=True)
        except ApiError:
            result = None
            error = {"code": "PERMISSION_DENIED", "message": "空间权限已变化，无法继续识别"}
        for source in sources:
            source.lease_until = None
            source.error = error
            source.status = "failed" if error else "ready"
        if error:
            return
        entries = list(db.scalars(select(ImportEntry).where(ImportEntry.task_id == task_id)))
        # Protect legacy human edits and commits. New batches expose no pending placeholders.
        if any(e.saved_item_id or e.overrides or e.input_mode == "manual" for e in entries):
            return
        for entry in entries:
            db.delete(entry)
        db.flush()
        for index, detected in enumerate(result):
            source_ids = [sources[i - 1].id for i in sorted(set(detected["source_indexes"]))]
            db.add(
                ImportEntry(
                    task_id=task_id,
                    # The first picture anchors batch ordering; source_ids is actual provenance.
                    source_id=sources[0].id,
                    candidate_index=index,
                    source_ids=source_ids,
                    recognized=detected["values"],
                    field_sources={
                        k: {**v, "source_ids": source_ids}
                        for k, v in detected["field_sources"].items()
                    },
                    warnings=detected["warnings"],
                    included=detected.get("included", True),
                )
            )


def run_worker(engine, settings, storage, stop):
    """Run off the API event loop; stop claiming on shutdown and drain active jobs."""
    with ThreadPoolExecutor(max_workers=settings.ai_max_concurrency) as pool:
        running = set()
        logger.info("AI worker started; concurrency=%s", settings.ai_max_concurrency)
        while not stop.is_set():
            for done in [future for future in running if future.done()]:
                running.remove(done)
                try:
                    done.result()
                except Exception as exc:
                    logger.error(
                        "Worker job failed (%s); expired leases will be recovered",
                        type(exc).__name__,
                    )
            if len(running) < settings.ai_max_concurrency:
                try:
                    job = claim(engine, settings)
                    if job:
                        running.add(pool.submit(process, engine, settings, storage, job))
                        continue
                except Exception as exc:
                    logger.error("Queue unavailable (%s)", type(exc).__name__)
            stop.wait(1)
    logger.info("AI worker stopped")


def main():
    parser = argparse.ArgumentParser(description="Cost Tracking AI worker")
    parser.add_argument("--once", action="store_true", help="Process one available batch and exit")
    args = parser.parse_args()
    settings = Settings()
    if not settings.ai_enabled:
        parser.error("AI_ENABLED must be true to run the worker")
    engine = make_engine(settings)
    storage = CosStorage(settings)
    logging.basicConfig(level=logging.INFO)
    try:
        if args.once:
            job = claim(engine, settings)
            if job:
                process(engine, settings, storage, job)
            return
        run_worker(engine, settings, storage, Event())
    except KeyboardInterrupt:
        pass
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
