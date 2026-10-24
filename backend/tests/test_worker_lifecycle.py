from threading import Event, Thread
from time import monotonic, sleep
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.worker import run_worker


@pytest.mark.parametrize(("ai", "embedded"), [(True, True), (False, True), (True, False)])
def test_api_lifecycle_starts_and_joins_worker(monkeypatch, ai, embedded):
    started, stopped = Event(), Event()
    calls = []

    def worker(engine, settings, storage, stop):
        calls.append((engine, storage))
        started.set()
        stop.wait(5)
        stopped.set()

    monkeypatch.setattr("app.main.run_worker", worker)
    settings = Settings(ai_enabled=ai, ai_worker_enabled=embedded)
    engine, storage = Mock(), Mock()
    app = create_app(settings, engine=engine, storage=storage)
    # Reload creates a new lifespan: the previous worker must already be gone.
    for _ in range(2):
        started.clear()
        stopped.clear()
        with TestClient(app):
            if ai and embedded:
                assert started.wait(2)
                assert not stopped.is_set()
        assert stopped.is_set() == (ai and embedded)
    assert calls == ([(engine, storage)] * 2 if ai and embedded else [])
    engine.dispose.assert_not_called()


def test_worker_shutdown_drains_job_and_stops_claiming(monkeypatch):
    stop, processing, finish, stopped = Event(), Event(), Event(), Event()
    claim = Mock(return_value=("task", ()))
    monkeypatch.setattr("app.worker.claim", claim)

    def process(*args):
        processing.set()
        assert finish.wait(5)

    monkeypatch.setattr("app.worker.process", process)

    def run():
        try:
            run_worker(None, SimpleNamespace(ai_max_concurrency=1), None, stop)
        finally:
            stopped.set()

    thread = Thread(target=run)
    thread.start()
    try:
        assert processing.wait(2)
        stop.set()
        assert not stopped.wait(0.1)
        finish.set()
        assert stopped.wait(2)
        assert claim.call_count == 1
    finally:
        stop.set()
        finish.set()
        thread.join(5)


def test_api_alone_processes_queued_import(environment, monkeypatch):
    from app.worker import process
    from tests.test_imports import detected, setup

    _, engine, settings, storage, headers, _, _, task, _ = setup(environment)
    settings.ai_worker_enabled = True
    calls = []

    def recognize(*args):
        calls.append(True)
        return detected("自动识别测试")

    monkeypatch.setattr(
        "app.worker.process",
        lambda engine, settings, storage, job: process(
            engine, settings, storage, job, recognizer=recognize
        ),
    )
    with TestClient(create_app(settings, engine=engine, storage=storage)) as client:
        deadline = monotonic() + 5
        while True:
            result = client.get(f"/api/v1/imports/{task['id']}", headers=headers).json()
            if result["status"] == "ready" or monotonic() >= deadline:
                break
            sleep(0.02)
        assert result["status"] == "ready"
        assert result["entries"][0]["values"]["name"] == "自动识别测试"
    assert calls == [True]
