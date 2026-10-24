"""Explicit, repeatable development fixtures: uv run python -m app.seed."""

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def main():
    settings = Settings()
    if settings.app_env != "development" or not settings.dev_auth_enabled:
        raise SystemExit("Seed is only available with development test login enabled")
    with TestClient(create_app(settings)) as client:
        response = client.post("/api/v1/auth/dev/login", json={"identity": "demo"})
        if response.status_code != 200:
            raise SystemExit("Seed login failed")
        headers = {"Authorization": "Bearer " + response.json()["access_token"]}
        space = client.get("/api/v1/spaces", headers=headers).json()["items"][0]["id"]
        samples = [
            {
                "name": "示例电脑",
                "purchase_amount_cents": 800000,
                "purchase_date": "2025-06-07",
            },
            {"name": "待补充的物品"},
        ]
        for index, sample in enumerate(samples):
            response = client.post(
                f"/api/v1/spaces/{space}/items",
                headers={**headers, "Idempotency-Key": f"seed-v1-{index}"},
                json=sample,
            )
            if response.status_code != 201:
                raise SystemExit("Seed item creation failed")
    print("Seed ready: development identity=demo, two sample items (repeat runs do not duplicate).")


if __name__ == "__main__":
    main()
