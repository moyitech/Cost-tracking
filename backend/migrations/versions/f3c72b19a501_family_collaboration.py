"""Family invitations, member nicknames and removal boundaries."""

import sqlalchemy as sa
from alembic import op

revision = "f3c72b19a501"
down_revision = "e8b31d2f6a90"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("members", sa.Column("nickname", sa.String(100), nullable=True))
    op.add_column(
        "members",
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.alter_column("members", "created_at", server_default=None)
    op.create_table(
        "invitations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("space_id", sa.String(36), sa.ForeignKey("spaces.id"), nullable=False),
        sa.Column("inviter_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token", sa.String(100), nullable=False, unique=True),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("role IN ('editor', 'viewer')"),
    )
    op.create_index("ix_invitations_space_id", "invitations", ["space_id"])
    op.create_table(
        "invitation_acceptances",
        sa.Column(
            "invitation_id", sa.String(36), sa.ForeignKey("invitations.id"), primary_key=True
        ),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "member_removals",
        sa.Column("space_id", sa.String(36), sa.ForeignKey("spaces.id"), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table("member_removals")
    op.drop_table("invitation_acceptances")
    op.drop_table("invitations")
    op.drop_column("members", "created_at")
    op.drop_column("members", "nickname")
