-- Reverses 0006_schema_v3.sql. Hand-written; keep in step with the up migration.
-- Lossy: reservations, integrations and activity are dropped, members become viewers, and
-- shares of equipment profiles are removed.
ALTER TABLE "inventory_items" DROP CONSTRAINT "inventory_items_tradeable_quantity_range";
ALTER TABLE "inventory_items" DROP CONSTRAINT "inventory_items_low_stock_nonneg";
ALTER TABLE "inventory_items" DROP CONSTRAINT "inventory_items_alpha_acid_range";
ALTER TABLE "inventory_items" DROP COLUMN "tradeable_quantity";
ALTER TABLE "inventory_items" DROP COLUMN "tradeable";
ALTER TABLE "inventory_items" DROP COLUMN "low_stock_threshold";
ALTER TABLE "inventory_items" DROP COLUMN "purchased_on";
ALTER TABLE "inventory_items" DROP COLUMN "alpha_acid_pct";
ALTER TABLE "inventory_items" DROP COLUMN "location";
ALTER TABLE "inventory_items" DROP COLUMN "lot";
ALTER TABLE "equipment_items" DROP COLUMN "held_by_user_id";
ALTER TABLE "equipment_items" DROP COLUMN "condition";
ALTER TABLE "equipment_items" DROP COLUMN "type";
ALTER TABLE "breweries" DROP COLUMN "description";
ALTER TABLE "memberships" ALTER COLUMN "role" SET DATA TYPE text;
UPDATE "memberships" SET "role" = 'viewer' WHERE "role" = 'member';
DROP TYPE "public"."brewery_role";
CREATE TYPE "public"."brewery_role" AS ENUM('owner', 'admin', 'brewer', 'viewer');
ALTER TABLE "memberships" ALTER COLUMN "role" SET DATA TYPE "public"."brewery_role" USING "role"::"public"."brewery_role";
DROP TABLE "inventory_reservations";
DROP TABLE "integrations";
DROP TABLE "activity_events";
DELETE FROM "shares" WHERE "resource_type" = 'equipment_profile';
ALTER TABLE "shares" ALTER COLUMN "resource_type" SET DATA TYPE text;
DROP TYPE "public"."shareable_type";
CREATE TYPE "public"."shareable_type" AS ENUM('recipe', 'batch', 'inventory_item', 'equipment_item', 'note');
ALTER TABLE "shares" ALTER COLUMN "resource_type" SET DATA TYPE "public"."shareable_type" USING "resource_type"::"public"."shareable_type";
DROP TYPE "public"."reservation_state";
DROP TYPE "public"."integration_kind";
DROP TYPE "public"."equipment_condition";
