"""Persist a separate family space avatar."""

import sqlalchemy as sa
from alembic import op

revision = "a6d925c104ab"
down_revision = "f3c72b19a501"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("spaces", sa.Column("avatar_file_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_spaces_avatar_file", "spaces", "files", ["avatar_file_id"], ["id"]
    )


def downgrade():
    op.drop_constraint("fk_spaces_avatar_file", "spaces", type_="foreignkey")
    op.drop_column("spaces", "avatar_file_id")
