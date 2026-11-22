CREATE TYPE "public"."batch_status" AS ENUM('planned', 'brewing', 'fermenting', 'conditioning', 'packaged', 'primary', 'secondary', 'bulk_aging', 'stabilized', 'bottled', 'bottle_aging', 'finished');--> statement-breakpoint
CREATE TYPE "public"."reading_source" AS ENUM('manual', 'device');--> statement-breakpoint
CREATE TYPE "public"."reminder_kind" AS ENUM('nutrient', 'rack', 'sulfite', 'taste', 'ready', 'custom');--> statement-breakpoint
CREATE TYPE "public"."unit_system" AS ENUM('us', 'metric');--> statement-breakpoint
ALTER TYPE "public"."visibility" ADD VALUE 'unlisted' BEFORE 'server';--> statement-breakpoint
CREATE TABLE "batch_status_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"batch_id" uuid NOT NULL,
	"status" "batch_status" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "equipment_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"uri" text NOT NULL,
	"owner_user_id" uuid,
	"owner_brewery_id" uuid,
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"catalog_id" text,
	"name" text NOT NULL,
	"batch_size_l" double precision,
	"boil_size_l" double precision,
	"kettle_volume_l" double precision,
	"kettle_loss_l" double precision,
	"boil_rate_l_per_hr" double precision,
	"mash_tun_volume_l" double precision,
	"grain_absorption_l_per_kg" double precision,
	"efficiency_pct" double precision,
	"fermenter_loss_l" double precision,
	CONSTRAINT "equipment_profiles_uri_unique" UNIQUE("uri"),
	CONSTRAINT "equipment_profiles_one_owner" CHECK (num_nonnulls("equipment_profiles"."owner_user_id", "equipment_profiles"."owner_brewery_id") = 1),
	CONSTRAINT "equipment_profiles_efficiency_range" CHECK ("equipment_profiles"."efficiency_pct" > 0 AND "equipment_profiles"."efficiency_pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"batch_id" uuid NOT NULL,
	"kind" "reminder_kind" NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"note" text,
	"done_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "status" "batch_status" DEFAULT 'planned' NOT NULL;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "equipment_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "brix" double precision;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "titratable_acidity_g_per_l" double precision;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "free_so2_mg_per_l" double precision;--> statement-breakpoint
ALTER TABLE "readings" ADD COLUMN "source" "reading_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD COLUMN "equipment_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "credit_imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "credit_license" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "forked_from_uri" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "forked_from_recipe_id" uuid;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "public_sharing_blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "units" "unit_system" DEFAULT 'us' NOT NULL;--> statement-breakpoint
ALTER TABLE "batch_status_changes" ADD CONSTRAINT "batch_status_changes_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_status_changes" ADD CONSTRAINT "batch_status_changes_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_profiles" ADD CONSTRAINT "equipment_profiles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_profiles" ADD CONSTRAINT "equipment_profiles_owner_brewery_id_breweries_id_fk" FOREIGN KEY ("owner_brewery_id") REFERENCES "public"."breweries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_profiles" ADD CONSTRAINT "equipment_profiles_catalog_id_equipment_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."equipment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batch_status_changes_batch_id_changed_at_index" ON "batch_status_changes" USING btree ("batch_id","changed_at");--> statement-breakpoint
CREATE INDEX "equipment_profiles_owner_user_idx" ON "equipment_profiles" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "equipment_profiles_owner_brewery_idx" ON "equipment_profiles" USING btree ("owner_brewery_id");--> statement-breakpoint
CREATE INDEX "reminders_batch_id_due_at_index" ON "reminders" USING btree ("batch_id","due_at");--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_equipment_profile_id_equipment_profiles_id_fk" FOREIGN KEY ("equipment_profile_id") REFERENCES "public"."equipment_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_equipment_profile_id_equipment_profiles_id_fk" FOREIGN KEY ("equipment_profile_id") REFERENCES "public"."equipment_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_forked_from_recipe_id_recipes_id_fk" FOREIGN KEY ("forked_from_recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipes_forked_from_recipe_id_index" ON "recipes" USING btree ("forked_from_recipe_id");--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_status_fits_beverage" CHECK (("beverage" = 'beer' AND "status" IN ('planned', 'brewing', 'fermenting', 'conditioning', 'packaged', 'finished')) OR ("beverage" <> 'beer' AND "status" IN ('planned', 'primary', 'secondary', 'bulk_aging', 'stabilized', 'bottled', 'bottle_aging', 'finished')));