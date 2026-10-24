"""Shared image presets, separate from private uploaded files."""

import sqlalchemy as sa
from alembic import op

revision = "e8b31d2f6a90"
down_revision = "d759fdebc831"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "image_presets",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("style", sa.String(20), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("object_key", sa.String(500), nullable=False, unique=True),
        sa.Column("preview_object_key", sa.String(500), nullable=False, unique=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.CheckConstraint("style IN ('cartoon', 'realistic')", name="ck_image_preset_style"),
        sa.CheckConstraint("version >= 1", name="ck_image_preset_version"),
    )
    op.add_column("items", sa.Column("image_preset_id", sa.String(80), nullable=True))
    op.create_foreign_key(
        "fk_items_image_preset", "items", "image_presets", ["image_preset_id"], ["id"]
    )
    op.create_check_constraint(
        "ck_item_image_source", "items", "image_file_id IS NULL OR image_preset_id IS NULL"
    )


def downgrade():
    op.drop_constraint("ck_item_image_source", "items", type_="check")
    op.drop_constraint("fk_items_image_preset", "items", type_="foreignkey")
    op.drop_column("items", "image_preset_id")
    op.drop_table("image_presets")
