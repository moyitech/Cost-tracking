from fastapi import Request
from sqlalchemy import create_engine
from sqlalchemy.orm import Session


def make_engine(settings):
    return create_engine(
        settings.database_url.get_secret_value(),
        pool_pre_ping=True,
        connect_args={"connect_timeout": 10},
    )


def get_db(request: Request):
    with Session(request.app.state.engine, expire_on_commit=False) as session:
        with session.begin():
            yield session
