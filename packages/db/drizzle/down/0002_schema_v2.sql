-- Reverses 0002_schema_v2.sql. Hand-written; keep in step with the up migration.
ALTER TABLE "batches" DROP CONSTRAINT "batches_status_fits_beverage";
ALTER TABLE "recipes" DROP CONSTRAINT "recipes_forked_from_recipe_id_recipes_id_fk";
ALTER TABLE "recipe_versions" DROP CONSTRAINT "recipe_versions_equipment_profile_id_equipment_profiles_id_fk";
ALTER TABLE "batches" DROP CONSTRAINT "batches_equipment_profile_id_equipment_profiles_id_fk";
ALTER TABLE "users" DROP COLUMN "units";
ALTER TABLE "recipes" DROP COLUMN "public_sharing_blocked";
ALTER TABLE "recipes" DROP COLUMN "forked_from_recipe_id";
ALTER TABLE "recipes" DROP COLUMN "forked_from_uri";
ALTER TABLE "recipes" DROP COLUMN "credit_license";
ALTER TABLE "recipes" DROP COLUMN "credit_imported_at";
ALTER TABLE "recipe_versions" DROP COLUMN "equipment_profile_id";
ALTER TABLE "readings" DROP COLUMN "source";
ALTER TABLE "readings" DROP COLUMN "free_so2_mg_per_l";
ALTER TABLE "readings" DROP COLUMN "titratable_acidity_g_per_l";
ALTER TABLE "readings" DROP COLUMN "brix";
ALTER TABLE "batches" DROP COLUMN "equipment_profile_id";
ALTER TABLE "batches" DROP COLUMN "status";
DROP TABLE "reminders";
DROP TABLE "equipment_profiles";
DROP TABLE "batch_status_changes";

-- Postgres can't remove an enum value, so rebuild "visibility" without 'unlisted'.
-- Unlisted items become private, the safe direction.
ALTER TYPE public.visibility RENAME TO visibility_v2;
CREATE TYPE "public"."visibility" AS ENUM('private', 'server', 'public');
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recipes', 'batches', 'inventory_items', 'equipment_items', 'notes'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN visibility DROP DEFAULT', t);
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN visibility TYPE public.visibility USING '
      '(CASE WHEN visibility::text = %L THEN %L ELSE visibility::text END)::public.visibility',
      t, 'unlisted', 'private');
    EXECUTE format('ALTER TABLE %I ALTER COLUMN visibility SET DEFAULT %L', t, 'private');
  END LOOP;
END;
$$;
DROP TYPE public.visibility_v2;

DROP TYPE "public"."unit_system";
DROP TYPE "public"."reminder_kind";
DROP TYPE "public"."reading_source";
DROP TYPE "public"."batch_status";
