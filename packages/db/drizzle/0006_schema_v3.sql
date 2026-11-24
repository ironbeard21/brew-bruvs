CREATE TYPE "public"."equipment_condition" AS ENUM('new', 'good', 'worn', 'needs_repair', 'retired');--> statement-breakpoint
CREATE TYPE "public"."integration_kind" AS ENUM('ispindel', 'gravitymon', 'tilt', 'rapt', 'webhook_out');--> statement-breakpoint
CREATE TYPE "public"."reservation_state" AS ENUM('reserved', 'used', 'released');--> statement-breakpoint
-- Rebuilt rather than ADD VALUE so the down file can rebuild the old type.
ALTER TABLE "shares" ALTER COLUMN "resource_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."shareable_type";--> statement-breakpoint
CREATE TYPE "public"."shareable_type" AS ENUM('recipe', 'batch', 'inventory_item', 'equipment_item', 'note', 'equipment_profile');--> statement-breakpoint
ALTER TABLE "shares" ALTER COLUMN "resource_type" SET DATA TYPE "public"."shareable_type" USING "resource_type"::"public"."shareable_type";--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"brewery_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"verb" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_user_id" uuid,
	"owner_brewery_id" uuid,
	"kind" "integration_kind" NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_hash" text,
	"batch_id" uuid,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "integrations_one_owner" CHECK (num_nonnulls("integrations"."owner_user_id", "integrations"."owner_brewery_id") = 1),
	CONSTRAINT "integrations_device_token" CHECK ("integrations"."kind" = 'webhook_out' OR "integrations"."token_hash" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"batch_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"quantity" double precision NOT NULL,
	"state" "reservation_state" DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservations_quantity_positive" CHECK ("inventory_reservations"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
-- Phase 1 had no brewery routes, but an install could hold admins: they keep full rights as owners.
UPDATE "memberships" SET "role" = 'owner' WHERE "role" = 'admin';--> statement-breakpoint
DROP TYPE "public"."brewery_role";--> statement-breakpoint
CREATE TYPE "public"."brewery_role" AS ENUM('owner', 'brewer', 'member', 'viewer');--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "role" SET DATA TYPE "public"."brewery_role" USING "role"::"public"."brewery_role";--> statement-breakpoint
ALTER TABLE "breweries" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD COLUMN "type" text;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD COLUMN "condition" "equipment_condition";--> statement-breakpoint
ALTER TABLE "equipment_items" ADD COLUMN "held_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "lot" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "alpha_acid_pct" double precision;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "purchased_on" date;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "low_stock_threshold" double precision;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "tradeable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "tradeable_quantity" double precision;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_brewery_id_breweries_id_fk" FOREIGN KEY ("brewery_id") REFERENCES "public"."breweries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_owner_brewery_id_breweries_id_fk" FOREIGN KEY ("owner_brewery_id") REFERENCES "public"."breweries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_brewery_id_at_index" ON "activity_events" USING btree ("brewery_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "integrations_owner_user_idx" ON "integrations" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "integrations_owner_brewery_idx" ON "integrations" USING btree ("owner_brewery_id");--> statement-breakpoint
CREATE INDEX "integrations_batch_id_index" ON "integrations" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_batch_id_index" ON "inventory_reservations" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_inventory_item_id_state_index" ON "inventory_reservations" USING btree ("inventory_item_id","state");--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_held_by_user_id_users_id_fk" FOREIGN KEY ("held_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_items_held_by_user_id_index" ON "equipment_items" USING btree ("held_by_user_id");--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_alpha_acid_range" CHECK ("inventory_items"."alpha_acid_pct" >= 0 AND "inventory_items"."alpha_acid_pct" <= 100);--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_low_stock_nonneg" CHECK ("inventory_items"."low_stock_threshold" >= 0);--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_tradeable_quantity_range" CHECK ("inventory_items"."tradeable_quantity" >= 0 AND "inventory_items"."tradeable_quantity" <= "inventory_items"."quantity");