-- Hand-written (drizzle-kit generate --custom). Two hard rules the database enforces itself:
-- credit on a recipe is permanent, and recipe versions never change.
-- Errors use SQLSTATE BB001 (credit) and BB002 (immutable version) so the API can map them.

-- Once a credit column has a value it can't be changed or cleared. Null → value is allowed.
CREATE FUNCTION "recipes_keep_credit"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  col text;
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
BEGIN
  FOREACH col IN ARRAY ARRAY[
    'credit_source_url', 'credit_site', 'credit_author', 'credit_imported_at',
    'credit_license', 'forked_from_uri'
  ] LOOP
    IF jsonb_typeof(old_row -> col) <> 'null' AND new_row -> col IS DISTINCT FROM old_row -> col THEN
      RAISE EXCEPTION 'recipe credit can''t be changed or removed (%)', col
        USING ERRCODE = 'BB001';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "recipes_keep_credit" BEFORE UPDATE ON "recipes"
  FOR EACH ROW EXECUTE FUNCTION "recipes_keep_credit"();
--> statement-breakpoint

-- Versions are snapshots. The only change allowed is a reference going null because the row it
-- points at was deleted (ON DELETE SET NULL on style, equipment profile and author). Postgres
-- runs that update after the delete, so a reference may go null only once its target is gone.
CREATE FUNCTION "recipe_versions_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  refs text[] := ARRAY['style_id', 'equipment_profile_id', 'created_by_user_id'];
BEGIN
  IF (to_jsonb(NEW) - refs) IS DISTINCT FROM (to_jsonb(OLD) - refs)
    OR (NEW.style_id IS DISTINCT FROM OLD.style_id
      AND (NEW.style_id IS NOT NULL OR EXISTS (SELECT FROM styles WHERE id = OLD.style_id)))
    OR (NEW.equipment_profile_id IS DISTINCT FROM OLD.equipment_profile_id
      AND (NEW.equipment_profile_id IS NOT NULL
        OR EXISTS (SELECT FROM equipment_profiles WHERE id = OLD.equipment_profile_id)))
    OR (NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
      AND (NEW.created_by_user_id IS NOT NULL
        OR EXISTS (SELECT FROM users WHERE id = OLD.created_by_user_id)))
  THEN
    RAISE EXCEPTION 'recipe versions can''t be changed; save a new version'
      USING ERRCODE = 'BB002';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "recipe_versions_immutable" BEFORE UPDATE ON "recipe_versions"
  FOR EACH ROW EXECUTE FUNCTION "recipe_versions_immutable"();
