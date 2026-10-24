from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def uid():
    return str(uuid4())


def now():
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    identity: Mapped[str] = mapped_column(String(200), unique=True)
    display_name: Mapped[str] = mapped_column(String(100), default="我")
    avatar_file_id: Mapped[str | None] = mapped_column(String(36))


class Space(Base):
    __tablename__ = "spaces"
    __table_args__ = (CheckConstraint("kind IN ('personal', 'family')"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(20))
    avatar_file_id: Mapped[str | None] = mapped_column(
        ForeignKey("files.id", name="fk_spaces_avatar_file", use_alter=True)
    )
    # NULL for family spaces; unique owner enforces exactly one personal space per user.
    personal_owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), unique=True)


class Member(Base):
    __tablename__ = "members"
    __table_args__ = (
        UniqueConstraint("space_id", "user_id"),
        CheckConstraint("role IN ('admin', 'editor', 'viewer')"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    space_id: Mapped[str] = mapped_column(ForeignKey("spaces.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    revision: Mapped[int] = mapped_column(Integer, default=1)
    nickname: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Invitation(Base):
    __tablename__ = "invitations"
    __table_args__ = (CheckConstraint("role IN ('editor', 'viewer')"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    space_id: Mapped[str] = mapped_column(ForeignKey("spaces.id"), index=True)
    inviter_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    token: Mapped[str] = mapped_column(String(100), unique=True)
    role: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class InvitationAcceptance(Base):
    __tablename__ = "invitation_acceptances"
    invitation_id: Mapped[str] = mapped_column(ForeignKey("invitations.id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class MemberRemoval(Base):
    __tablename__ = "member_removals"
    space_id: Mapped[str] = mapped_column(ForeignKey("spaces.id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    removed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class LoginSession(Base):
    __tablename__ = "login_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("login_sessions.id"), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Item(Base):
    __tablename__ = "items"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'sold', 'retired')"),
        CheckConstraint("purchase_amount_cents >= 0"),
        CheckConstraint("recovery_amount_cents >= 0"),
        CheckConstraint("revision >= 1"),
        CheckConstraint(
            "image_file_id IS NULL OR image_preset_id IS NULL", name="ck_item_image_source"
        ),
        CheckConstraint(
            "(status = 'active' AND disposal_date IS NULL AND recovery_amount_cents IS NULL) OR (status <> 'active' AND disposal_date IS NOT NULL AND recovery_amount_cents IS NOT NULL)"
        ),
        Index("ix_items_space_created_id", "space_id", "created_at", "id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    space_id: Mapped[str] = mapped_column(ForeignKey("spaces.id"))
    name: Mapped[str] = mapped_column(String(200))
    # Retired attributes are retained for historical data, never read/written by item APIs.
    legacy_category: Mapped[str] = mapped_column("category", String(100), default="未分类")
    legacy_brand: Mapped[str | None] = mapped_column("brand", String(200))
    legacy_model: Mapped[str | None] = mapped_column("model", String(200))
    legacy_location: Mapped[str | None] = mapped_column("location", String(200))
    legacy_channel: Mapped[str | None] = mapped_column("channel", String(200))
    legacy_serial: Mapped[str | None] = mapped_column("serial", String(200))
    legacy_warranty: Mapped[str | None] = mapped_column("warranty", String(200))
    note: Mapped[str | None] = mapped_column(String(10000))
    purchase_amount_cents: Mapped[int | None] = mapped_column(BigInteger)
    purchase_date: Mapped[date | None] = mapped_column(Date)
    image_file_id: Mapped[str | None] = mapped_column(ForeignKey("files.id"))
    image_preset_id: Mapped[str | None] = mapped_column(ForeignKey("image_presets.id"))
    attachment_file_ids: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="active")
    disposal_date: Mapped[date | None] = mapped_column(Date)
    recovery_amount_cents: Mapped[int | None] = mapped_column(BigInteger)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expenses: Mapped[list["Expense"]] = relationship(lazy="selectin", order_by="Expense.id")


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (CheckConstraint("amount_cents >= 0"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"), index=True)
    category: Mapped[str] = mapped_column(String(100))
    amount_cents: Mapped[int] = mapped_column(BigInteger)
    occurred_on: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(String(10000))
    attachment_file_ids: Mapped[list] = mapped_column(JSON, default=list)


class ImagePreset(Base):
    """Shared artwork catalog; never participates in private file authorization."""

    __tablename__ = "image_presets"
    __table_args__ = (
        CheckConstraint("style IN ('cartoon', 'realistic')", name="ck_image_preset_style"),
        CheckConstraint("version >= 1", name="ck_image_preset_version"),
    )
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    style: Mapped[str] = mapped_column(String(20))
    version: Mapped[int] = mapped_column(Integer)
    object_key: Mapped[str] = mapped_column(String(500), unique=True)
    preview_object_key: Mapped[str] = mapped_column(String(500), unique=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(default=True)


class StoredFile(Base):
    __tablename__ = "files"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    uploader_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    space_id: Mapped[str] = mapped_column(ForeignKey("spaces.id"))
    object_key: Mapped[str] = mapped_column(String(500), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    purpose: Mapped[str] = mapped_column(String(30))
    state: Mapped[str] = mapped_column(String(20), default="pending")
    staging_key: Mapped[str] = mapped_column(String(500), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class FileLink(Base):
    __tablename__ = "file_links"
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id"), primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"), primary_key=True)


class Event(Base):
    __tablename__ = "events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    item_id: Mapped[str | None] = mapped_column(ForeignKey("items.id"), index=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("spaces.id"), index=True)
    type: Mapped[str] = mapped_column(String(60))
    title: Mapped[str] = mapped_column(String(200))
    occurred_on: Mapped[date | None] = mapped_column(Date)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    actor: Mapped[dict] = mapped_column(JSON)
    changes: Mapped[list] = mapped_column(JSON)


class Idempotency(Base):
    __tablename__ = "idempotency"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    scope: Mapped[str] = mapped_column(String(200), primary_key=True)
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    response: Mapped[dict] = mapped_column(JSON)
    item_id: Mapped[str | None] = mapped_column(ForeignKey("items.id"))


class ImportTask(Base):
    __tablename__ = "import_tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    space_id: Mapped[str] = mapped_column(ForeignKey("spaces.id"))
    canceled: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ImportSource(Base):
    __tablename__ = "import_sources"
    __table_args__ = (UniqueConstraint("task_id", "file_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    task_id: Mapped[str] = mapped_column(ForeignKey("import_tasks.id"), index=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id"))
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    removed: Mapped[bool] = mapped_column(default=False)
    generation: Mapped[int] = mapped_column(default=0)
    attempts: Mapped[int] = mapped_column(default=0)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ImportEntry(Base):
    __tablename__ = "import_entries"
    __table_args__ = (UniqueConstraint("task_id", "source_id", "candidate_index"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    task_id: Mapped[str] = mapped_column(ForeignKey("import_tasks.id"), index=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("import_sources.id"))
    candidate_index: Mapped[int] = mapped_column(default=0)
    source_ids: Mapped[list] = mapped_column(JSON, default=list)
    recognized: Mapped[dict] = mapped_column(JSON, default=dict)
    overrides: Mapped[dict] = mapped_column(JSON, default=dict)
    field_sources: Mapped[dict] = mapped_column(JSON, default=dict)
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    # Keep the old column for existing databases; no longer part of review or commit.
    legacy_quantity_resolved: Mapped[bool] = mapped_column("quantity_resolved", default=True)
    input_mode: Mapped[str] = mapped_column(String(20), default="recognized")
    included: Mapped[bool] = mapped_column(default=True)
    confirmed: Mapped[bool] = mapped_column(default=False)
    duplicate_decision: Mapped[str | None] = mapped_column(String(30))
    existing_item_id: Mapped[str | None] = mapped_column(ForeignKey("items.id"))
    revision: Mapped[int] = mapped_column(default=1)
    saved_item_id: Mapped[str | None] = mapped_column(ForeignKey("items.id"), unique=True)
    last_result: Mapped[dict | None] = mapped_column(JSON)


class ImportSubmission(Base):
    __tablename__ = "import_submissions"
    task_id: Mapped[str] = mapped_column(ForeignKey("import_tasks.id"), primary_key=True)
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)
    response: Mapped[dict | None] = mapped_column(JSON)
