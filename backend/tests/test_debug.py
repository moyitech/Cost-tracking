from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.mark.parametrize("app_env", ["development", "test", "production"])
def test_env_controls_unhandled_error_response(tmp_path, monkeypatch, app_env):
    monkeypatch.delenv("APP_ENV", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text(f"APP_ENV={app_env}\n")
    settings = Settings(
        _env_file=env_file,
        database_url="sqlite://",
        jwt_secret="test-secret-" * 5,
        dev_auth_enabled=False,
        ai_worker_enabled=False,
    )
    app = create_app(settings, engine=Mock(), storage=Mock())

    @app.get("/debug-error")
    def fail():
        raise RuntimeError("debug-test-error")

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/debug-error")

    assert response.status_code == 500
    if app_env == "development":
        assert "Traceback" in response.text
        assert "debug-test-error" in response.text
    else:
        assert response.json()["error"]["code"] == "INTERNAL_ERROR"
        assert "debug-test-error" not in response.text
        assert "Traceback" not in response.text
