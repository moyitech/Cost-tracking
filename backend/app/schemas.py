from datetime import date, datetime
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator

Money = Annotated[StrictInt, Field(ge=0, le=9_000_000_000_000_000)]
Name = Annotated[str, Field(min_length=1, max_length=200)]
Note = Annotated[str, Field(max_length=10000)]
FileIds = Annotated[list[str], Field(max_length=100)]
PresetId = Annotated[str, Field(min_length=1, max_length=80, pattern=r"^[a-z][a-z0-9-]*$")]
RETIRED_ITEM_FIELDS = {"category", "brand", "model", "location", "channel", "serial", "warranty"}


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ItemCreate(Input):
    name: Name
    note: Note | None = None
    purchase_amount_cents: Money | None = None
    purchase_date: date | None = None
    image_file_id: str | None = None
    image_preset_id: PresetId | None = None
    attachment_file_ids: FileIds = Field(default_factory=list)

    @model_validator(mode="after")
    def one_image_source(self):
        if self.image_file_id is not None and self.image_preset_id is not None:
            raise ValueError("预设与相册照片只能选择一种")
        return self


class ItemPatch(ItemCreate):
    name: Name | None = None

    @model_validator(mode="after")
    def required_name(self):
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be null")
        return self


class ExpenseCreate(Input):
    category: Annotated[str, Field(min_length=1, max_length=100)]
    amount_cents: Money
    occurred_on: date
    note: Note | None = None
    attachment_file_ids: FileIds = Field(default_factory=list)


class ExpensePatch(Input):
    category: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    amount_cents: Money | None = None
    occurred_on: date | None = None
    note: Note | None = None
    attachment_file_ids: FileIds | None = None

    @model_validator(mode="after")
    def required_fields(self):
        for field in ("category", "amount_cents", "occurred_on", "attachment_file_ids"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class Disposal(Input):
    status: Literal["sold", "retired"]
    disposal_date: date
    recovery_amount_cents: Money
    confirmed_zero: bool = False

    @model_validator(mode="after")
    def zero_confirmation(self):
        if self.recovery_amount_cents == 0 and not self.confirmed_zero:
            raise ValueError("zero recovery requires confirmed_zero=true")
        return self


class DevLogin(Input):
    identity: Annotated[str, Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_.-]+$")]


class WechatLogin(Input):
    code: Annotated[str, Field(min_length=1, max_length=512)]


class RefreshInput(Input):
    refresh_token: Annotated[str, Field(min_length=1, max_length=512)]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    display_name: str
    avatar_file_id: str | None


class AvatarInput(Input):
    avatar_file_id: Annotated[str, Field(min_length=1, max_length=36)] | None


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class SpaceOut(BaseModel):
    id: str
    name: str
    kind: Literal["personal", "family"]
    role: Literal["admin", "editor", "viewer"]
    avatar_file_id: str | None = None
    member_count: int | None = None
    item_count: int | None = None


class SpacesOut(BaseModel):
    items: list[SpaceOut]


class ExpenseOut(ExpenseCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str


class Metrics(BaseModel):
    as_of_date: date
    extra_cents: int
    known_investment_cents: int
    total_investment_cents: int | None
    holding_days: int | None
    net_cost_cents: int | None
    current_daily_yuan: str | None
    actual_daily_yuan: str | None


class ItemOut(ItemCreate):
    created_at: datetime
    id: str
    space_id: str
    status: Literal["active", "sold", "retired"]
    disposal_date: date | None
    recovery_amount_cents: int | None
    deleted_at: datetime | None
    revision: int
    expenses: list[ExpenseOut]
    metrics: Metrics


class StatusCounts(BaseModel):
    active: int
    sold: int
    retired: int


class CurrentDaily(BaseModel):
    known_amount_yuan: str | None
    holding_count: int
    incomplete_count: int
    complete: bool


class SummaryOut(BaseModel):
    as_of_date: date
    item_count: int
    status_counts: StatusCounts
    known_investment_cents: int
    purchase_amount_missing_count: int
    current_daily: CurrentDaily


class DisposedOut(BaseModel):
    item_count: int
    known_net_cost_cents: int | None
    incomplete_count: int


class AnalyticsOut(BaseModel):
    as_of_date: date
    item_count: int
    status_counts: StatusCounts
    known_purchase_cents: int
    extra_cents: int
    purchase_amount_missing_count: int
    disposed: DisposedOut


class Change(BaseModel):
    field: str
    before: object = None
    after: object = None


class Actor(BaseModel):
    id: str
    display_name: str


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    item_id: str | None
    type: str
    title: str
    occurred_on: date | None
    recorded_at: datetime
    actor: Actor
    changes: list[Change]

    @field_validator("changes", mode="before")
    @classmethod
    def current_item_changes(cls, changes):
        return [
            c
            for c in changes
            if (c.get("field") if isinstance(c, dict) else c.field) not in RETIRED_ITEM_FIELDS
        ]


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    next_cursor: str | None


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    mime_type: str
    size_bytes: int


class FileAccess(BaseModel):
    url: str
    expires_at: datetime


class ImagePresetOut(BaseModel):
    id: str
    name: str
    style: Literal["cartoon", "realistic"]
    version: int
    url: str
    preview_url: str
    expires_at: datetime


class ImagePresetsOut(BaseModel):
    items: list[ImagePresetOut]


class UploadIntent(Input):
    space_id: str
    purpose: Literal["item_image", "receipt", "import_source", "personal_avatar", "family_avatar"]
    name: Annotated[str, Field(min_length=1, max_length=255)]
    mime_type: Literal["image/jpeg", "image/png", "image/webp"]
    size_bytes: Annotated[StrictInt, Field(gt=0)]


class UploadOut(BaseModel):
    id: str
    url: str
    method: Literal["PUT"] = "PUT"
    headers: dict[str, str]
    expires_at: datetime


class FieldError(BaseModel):
    field: str
    code: str
    message: str


class ErrorBody(BaseModel):
    code: str
    message: str
    field_errors: list[FieldError]
    details: dict
    request_id: str


class ErrorOut(BaseModel):
    error: ErrorBody
