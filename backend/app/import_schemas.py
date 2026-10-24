from typing import Annotated, Literal

from pydantic import BaseModel, Field, StrictInt, model_validator

from app.schemas import Input, ItemCreate, Name


class SourceInput(Input):
    source_file_ids: Annotated[list[str], Field(min_length=1, max_length=30)]


class RetrySource(Input):
    source_id: str
    replacement_file_id: str | None = None


class RetryInput(Input):
    # Accepted only to return an explicit conflict to clients using the old API.
    sources: list[RetrySource] | None = None


class DraftValues(ItemCreate):
    name: Name | None = None


class EntryPatch(Input):
    values: DraftValues | None = None
    input_mode: Literal["recognized", "manual"] | None = None
    included: bool | None = None
    confirmed: bool | None = None
    duplicate_decision: Literal["unresolved", "skip_existing", "create_independent"] | None = None
    existing_item_id: str | None = None

    @model_validator(mode="before")
    @classmethod
    def ignore_retired_quantity_confirmation(cls, values):
        # Older clients may still send this flag; it no longer gates saving.
        if isinstance(values, dict):
            return {key: value for key, value in values.items() if key != "quantity_resolved"}
        return values


class CommitEntry(Input):
    entry_id: str
    revision: Annotated[StrictInt, Field(ge=1)]


class CommitInput(Input):
    entries: Annotated[list[CommitEntry], Field(min_length=1, max_length=100)]


class ResultOut(BaseModel):
    entry_id: str
    status: Literal["saved", "already_saved", "skipped", "failed"]
    item_id: str | None = None
    error: dict | None = None


class CommitOut(BaseModel):
    results: list[ResultOut]


class SourceOut(BaseModel):
    id: str
    file_id: str
    name: str
    status: str
    attempts: int
    error: dict | None
    retryable: bool


class EntryOut(BaseModel):
    id: str
    revision: int
    source_ids: list[str]
    values: DraftValues
    field_sources: dict
    warnings: list[str]
    duplicate_candidates: list[dict]
    duplicate_decision: str | None
    existing_item_id: str | None
    input_mode: str
    included: bool
    confirmed: bool
    saved_item_id: str | None


class TaskOut(BaseModel):
    id: str
    space_id: str
    status: str
    sources: list[SourceOut]
    entries: list[EntryOut]
    results: list[ResultOut]
    poll_after_ms: int | None
