from datetime import date
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.config import Settings
from app.main import create_app


class FakeStorage:
    def __init__(self):
        self.completed = []

    def upload_url(self, file):
        return "https://cos.example.test/" + file.staging_key

    def complete(self, file):
        self.completed.append(file.id)

    def access_url(self, file):
        return "https://cos.example.test/" + file.object_key

    def preset_url(self, preset, size):
        key = preset.preview_object_key if size == "preview" else preset.object_key
        return "https://cos.example.test/" + key


@pytest.fixture
def environment():
    # All tests use a disposable PostgreSQL schema; never clear public/application tables.
    settings = Settings(
        app_env="test", dev_auth_enabled=True, jwt_secret="test-secret-" * 5,
        ai_worker_enabled=False,
    )
    schema = "ct_test_" + uuid4().hex
    root_engine = create_engine(settings.database_url.get_secret_value())
    with root_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(
        settings.database_url.get_secret_value(),
        connect_args={"options": f"-csearch_path={schema}"},
        pool_size=10,
    )
    try:
        with engine.begin() as conn:
            config = Config("alembic.ini")
            config.attributes["connection"] = conn
            command.upgrade(config, "head")
        storage = FakeStorage()
        app = create_app(
            settings=settings, engine=engine, storage=storage, clock=lambda: date(2026, 10, 19)
        )
        with TestClient(app) as client:
            yield client, engine, settings, storage
    finally:
        engine.dispose()
        with root_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        root_engine.dispose()


@pytest.fixture
def client(environment):
    return environment[0]


def authenticate(client, identity="alice"):
    response = client.post("/api/v1/auth/dev/login", json={"identity": identity})
    assert response.status_code == 200, response.text
    data = response.json()
    headers = {"Authorization": "Bearer " + data["access_token"]}
    spaces = client.get("/api/v1/spaces", headers=headers).json()["items"]
    assert len(spaces) == 1
    return headers, spaces[0]["id"], data


def create(client, headers, space, key=None, **fields):
    response = client.post(
        f"/api/v1/spaces/{space}/items",
        headers={**headers, "Idempotency-Key": key or uuid4().hex},
        json={"name": "电脑", **fields},
    )
    assert response.status_code == 201, response.text
    return response.json()
