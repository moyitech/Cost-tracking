"""Run the API with the project's default listen address and port."""

import argparse

import uvicorn

from app.config import Settings


def main():
    parser = argparse.ArgumentParser(description="Cost Tracking API")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=18080)
    parser.add_argument(
        "--reload",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="Enable/disable auto-reload (default: enabled in development)",
    )
    args = parser.parse_args()
    settings = Settings()
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=args.host,
        port=args.port,
        reload=args.reload if args.reload is not None else settings.app_env == "development",
    )


if __name__ == "__main__":
    main()
