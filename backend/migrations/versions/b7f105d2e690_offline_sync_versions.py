"""Transactional space versions for offline snapshots, including non-API writes."""

import sqlalchemy as sa
from alembic import op

revision = "b7f105d2e690"
down_revision = "a6d925c104ab"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("spaces", sa.Column("sync_revision", sa.BigInteger(), nullable=False, server_default="1"))
    op.execute("""
    CREATE FUNCTION ct_bump_spaces(ids text[]) RETURNS void LANGUAGE plpgsql AS $$
    DECLARE sid text;
    BEGIN
      FOR sid IN SELECT id FROM spaces WHERE id = ANY(ids) ORDER BY id FOR UPDATE LOOP
        UPDATE spaces SET sync_revision = sync_revision + 1 WHERE id = sid;
      END LOOP;
    END $$;

    CREATE FUNCTION ct_related_sync() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE before_row jsonb; after_row jsonb; ids text[];
    BEGIN
      IF TG_OP <> 'INSERT' THEN before_row := to_jsonb(OLD); END IF;
      IF TG_OP <> 'DELETE' THEN after_row := to_jsonb(NEW); END IF;
      IF TG_TABLE_NAME = 'expenses' THEN
        SELECT array_agg(space_id::text) INTO ids FROM items
          WHERE id IN (before_row->>'item_id', after_row->>'item_id');
      ELSIF TG_TABLE_NAME = 'events' THEN
        SELECT array_agg(sid) INTO ids FROM (
          SELECT space_id::text AS sid FROM items
            WHERE id IN (before_row->>'item_id', after_row->>'item_id')
          UNION SELECT before_row->>'space_id'
          UNION SELECT after_row->>'space_id'
        ) affected;
      ELSIF TG_TABLE_NAME = 'users' THEN
        IF before_row->>'display_name' IS NOT DISTINCT FROM after_row->>'display_name'
          AND before_row->>'avatar_file_id' IS NOT DISTINCT FROM after_row->>'avatar_file_id'
          THEN RETURN NULL; END IF;
        SELECT array_agg(space_id::text) INTO ids FROM members
          WHERE user_id = after_row->>'id';
      ELSE
        ids := ARRAY[before_row->>'space_id', after_row->>'space_id'];
      END IF;
      PERFORM ct_bump_spaces(ids);
      RETURN NULL;
    END $$;

    CREATE FUNCTION ct_space_sync() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF ROW(OLD.name, OLD.kind, OLD.avatar_file_id, OLD.personal_owner_id)
        IS DISTINCT FROM ROW(NEW.name, NEW.kind, NEW.avatar_file_id, NEW.personal_owner_id)
        THEN NEW.sync_revision := OLD.sync_revision + 1; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER ct_space_sync BEFORE UPDATE OF name, kind, avatar_file_id, personal_owner_id
      ON spaces FOR EACH ROW EXECUTE FUNCTION ct_space_sync();
    CREATE TRIGGER ct_user_sync AFTER UPDATE OF display_name, avatar_file_id
      ON users FOR EACH ROW EXECUTE FUNCTION ct_related_sync();
    """)
    for table in ("items", "expenses", "events", "members"):
        op.execute(f"CREATE TRIGGER ct_{table}_sync AFTER INSERT OR UPDATE OR DELETE ON {table} "
                   "FOR EACH ROW EXECUTE FUNCTION ct_related_sync()")


def downgrade():
    for table in ("items", "expenses", "events", "members"):
        op.execute(f"DROP TRIGGER ct_{table}_sync ON {table}")
    op.execute("DROP TRIGGER ct_user_sync ON users; DROP TRIGGER ct_space_sync ON spaces")
    op.execute("DROP FUNCTION ct_related_sync(); DROP FUNCTION ct_space_sync(); DROP FUNCTION ct_bump_spaces(text[])")
    op.drop_column("spaces", "sync_revision")
