-- Reverses 0009_row_level_security.sql. Hand-written; keep in step with the up migration.
-- The brew_app role stays: roles belong to the whole Postgres cluster, not this database.
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'recipes', 'batches', 'notes', 'inventory_items', 'equipment_items', 'equipment_profiles',
    'recipe_versions', 'batch_status_changes', 'readings', 'reminders', 'inventory_reservations',
    'shares', 'integrations', 'activity_events', 'webhook_jobs'
  ] LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON %I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_guard_change', t);
  END LOOP;
END $$;
DROP SCHEMA app CASCADE;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM brew_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM brew_app;
REVOKE USAGE ON SCHEMA public FROM brew_app;
