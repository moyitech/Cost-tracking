from functools import partial
from unittest.mock import Mock

import pytest

from app.__main__ import main
from app.config import Settings


@pytest.mark.parametrize("app_env", ["development", "test", "production"])
@pytest.mark.parametrize("override", [None, "--reload", "--no-reload"])
def test_reload_follows_env_with_cli_override(tmp_path, monkeypatch, app_env, override):
    monkeypatch.delenv("APP_ENV", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text(f"APP_ENV={app_env}\n")
    monkeypatch.setattr(
        "app.__main__.Settings",
        partial(
            Settings,
            _env_file=env_file,
            database_url="sqlite://",
            jwt_secret="test-secret-" * 5,
            dev_auth_enabled=False,
        ),
    )
    run = Mock()
    monkeypatch.setattr("app.__main__.uvicorn.run", run)
    monkeypatch.setattr("sys.argv", ["app", *([override] if override else [])])

    main()

    expected = app_env == "development" if override is None else override == "--reload"
    run.assert_called_once_with(
        "app.main:create_app", factory=True, host="0.0.0.0", port=18080, reload=expected
    )
