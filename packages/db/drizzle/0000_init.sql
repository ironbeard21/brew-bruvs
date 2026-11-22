CREATE TYPE "public"."beverage" AS ENUM('beer', 'mead', 'wine', 'cider');--> statement-breakpoint
CREATE TYPE "public"."brewery_role" AS ENUM('owner', 'admin', 'brewer', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."quantity_unit" AS ENUM('kg', 'l', 'each');--> statement-breakpoint
CREATE TYPE "public"."share_level" AS ENUM('read', 'edit');--> statement-breakpoint
CREATE TYPE "public"."shareable_type" AS ENUM('recipe', 'batch', 'inventory_item', 'equipment_item', 'note');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('private', 'server', 'public');--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"uri" text NOT NULL,
	"owner_user_id" uuid,
	"owner_brewery_id" uuid,
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recipe_version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"beverage" "beverage" NOT NULL,
	"batch_size_l" double precision,
	"brewed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "batches_uri_unique" UNIQUE("uri"),
	CONSTRAINT "batches_one_owner" CHECK (num_nonnulls("batches"."owner_user_id", "batches"."owner_brewery_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "breweries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"uri" text NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "breweries_uri_unique" UNIQUE("uri")
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"sources" text[] NOT NULL,
	"licenses" text[] NOT NULL,
	"notes" text,
	"category" text,
	"batch_size_l" double precision,
	"boil_size_l" double precision,
	"kettle_volume_l" double precision,
	"kettle_loss_l" double precision,
	"boil_rate_l_per_hr" double precision,
	"mash_tun_volume_l" double precision,
	"grain_absorption_l_per_kg" double precision
);
--> statement-breakpoint
CREATE TABLE "equipment_items" (
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
	"notes" text,
	CONSTRAINT "equipment_items_uri_unique" UNIQUE("uri"),
	CONSTRAINT "equipment_items_one_owner" CHECK (num_nonnulls("equipment_items"."owner_user_id", "equipment_items"."owner_brewery_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "fermentables" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"sources" text[] NOT NULL,
	"licenses" text[] NOT NULL,
	"notes" text,
	"fermentable_type" text,
	"producer" text,
	"product_id" text,
	"origin" text,
	"category" text,
	"color_ebc" double precision,
	"yield_pct" double precision,
	"potential_sg" double precision,
	"max_in_batch_pct" double precision,
	"diastatic_power_lintner" double precision,
	"protein_pct" double precision,
	"moisture_pct" double precision,
	"beverages" "beverage"[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hops" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"sources" text[] NOT NULL,
	"licenses" text[] NOT NULL,
	"notes" text,
	"origin" text,
	"hop_type" text,
	"alpha_acid_pct" double precision,
	"alpha_acid_min_pct" double precision,
	"alpha_acid_max_pct" double precision,
	"beta_acid_pct" double precision,
	"cohumulone_pct" double precision,
	"total_oil_ml_per_100g" double precision,
	"myrcene_pct" double precision,
	"humulene_pct" double precision,
	"caryophyllene_pct" double precision,
	"farnesene_pct" double precision,
	"hsi" double precision,
	"substitutes" text,
	"beverages" "beverage"[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"uri" text NOT NULL,
	"owner_user_id" uuid,
	"owner_brewery_id" uuid,
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"catalog_id" text,
	"name" text NOT NULL,
	"quantity" double precision NOT NULL,
	"quantity_unit" "quantity_unit" NOT NULL,
	"best_before" date,
	"notes" text,
	CONSTRAINT "inventory_items_uri_unique" UNIQUE("uri"),
	CONSTRAINT "inventory_items_one_owner" CHECK (num_nonnulls("inventory_items"."owner_user_id", "inventory_items"."owner_brewery_id") = 1),
	CONSTRAINT "inventory_items_quantity_nonneg" CHECK ("inventory_items"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"brewery_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "brewery_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_brewery_id_user_id_pk" PRIMARY KEY("brewery_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "miscs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"sources" text[] NOT NULL,
	"licenses" text[] NOT NULL,
	"notes" text,
	"misc_type" text,
	"water_agent_type" text,
	"use" text,
	"use_for" text,
	"category" text,
	"beverages" "beverage"[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"uri" text NOT NULL,
	"owner_user_id" uuid,
	"owner_brewery_id" uuid,
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recipe_id" uuid,
	"batch_id" uuid,
	"body" text NOT NULL,
	CONSTRAINT "notes_uri_unique" UNIQUE("uri"),
	CONSTRAINT "notes_one_owner" CHECK (num_nonnulls("notes"."owner_user_id", "notes"."owner_brewery_id") = 1),
	CONSTRAINT "notes_one_subject" CHECK (num_nonnulls("notes"."recipe_id", "notes"."batch_id") <= 1)
);
--> statement-breakpoint
CREATE TABLE "readings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"batch_id" uuid NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"gravity_sg" double precision,
	"temperature_c" double precision,
	"ph" double precision,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"beverage" "beverage" NOT NULL,
	"style_id" text,
	"batch_size_l" double precision NOT NULL,
	"content" jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_versions_recipe_id_version_unique" UNIQUE("recipe_id","version"),
	CONSTRAINT "recipe_versions_version_positive" CHECK ("recipe_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"uri" text NOT NULL,
	"owner_user_id" uuid,
	"owner_brewery_id" uuid,
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"beverage" "beverage" NOT NULL,
	"credit_source_url" text,
	"credit_site" text,
	"credit_author" text,
	CONSTRAINT "recipes_uri_unique" UNIQUE("uri"),
	CONSTRAINT "recipes_one_owner" CHECK (num_nonnulls("recipes"."owner_user_id", "recipes"."owner_brewery_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"resource_type" "shareable_type" NOT NULL,
	"resource_id" uuid NOT NULL,
	"to_user_id" uuid,
	"to_brewery_id" uuid,
	"level" "share_level" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shares_target_key" UNIQUE NULLS NOT DISTINCT("resource_type","resource_id","to_user_id","to_brewery_id"),
	CONSTRAINT "shares_one_target" CHECK (num_nonnulls("shares"."to_user_id", "shares"."to_brewery_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "styles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"sources" text[] NOT NULL,
	"licenses" text[] NOT NULL,
	"notes" text,
	"style_guide" text NOT NULL,
	"style_id" text,
	"category" text,
	"beverage" "beverage" NOT NULL,
	"og_min" double precision,
	"og_max" double precision,
	"fg_min" double precision,
	"fg_max" double precision,
	"ibu_min" double precision,
	"ibu_max" double precision,
	"color_ebc_min" double precision,
	"color_ebc_max" double precision,
	"abv_min_pct" double precision,
	"abv_max_pct" double precision,
	"carb_vols_min" double precision,
	"carb_vols_max" double precision
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"uri" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"city" text,
	"state" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_uri_unique" UNIQUE("uri")
);
--> statement-breakpoint
CREATE TABLE "water_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"sources" text[] NOT NULL,
	"licenses" text[] NOT NULL,
	"notes" text,
	"calcium_ppm" double precision,
	"magnesium_ppm" double precision,
	"sodium_ppm" double precision,
	"sulfate_ppm" double precision,
	"chloride_ppm" double precision,
	"bicarbonate_ppm" double precision
);
--> statement-breakpoint
CREATE TABLE "yeasts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"sources" text[] NOT NULL,
	"licenses" text[] NOT NULL,
	"notes" text,
	"producer" text,
	"product_id" text,
	"yeast_type" text,
	"form" text,
	"temp_min_c" double precision,
	"temp_max_c" double precision,
	"attenuation_min_pct" double precision,
	"attenuation_max_pct" double precision,
	"flocculation" text,
	"alcohol_tolerance_pct" double precision,
	"best_for" text,
	"beverages" "beverage"[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_owner_brewery_id_breweries_id_fk" FOREIGN KEY ("owner_brewery_id") REFERENCES "public"."breweries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_recipe_version_id_recipe_versions_id_fk" FOREIGN KEY ("recipe_version_id") REFERENCES "public"."recipe_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_owner_brewery_id_breweries_id_fk" FOREIGN KEY ("owner_brewery_id") REFERENCES "public"."breweries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_catalog_id_equipment_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."equipment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_owner_brewery_id_breweries_id_fk" FOREIGN KEY ("owner_brewery_id") REFERENCES "public"."breweries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_brewery_id_breweries_id_fk" FOREIGN KEY ("brewery_id") REFERENCES "public"."breweries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_owner_brewery_id_breweries_id_fk" FOREIGN KEY ("owner_brewery_id") REFERENCES "public"."breweries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_style_id_styles_id_fk" FOREIGN KEY ("style_id") REFERENCES "public"."styles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_owner_brewery_id_breweries_id_fk" FOREIGN KEY ("owner_brewery_id") REFERENCES "public"."breweries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_to_brewery_id_breweries_id_fk" FOREIGN KEY ("to_brewery_id") REFERENCES "public"."breweries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batches_owner_user_idx" ON "batches" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "batches_owner_brewery_idx" ON "batches" USING btree ("owner_brewery_id");--> statement-breakpoint
CREATE INDEX "batches_recipe_version_id_index" ON "batches" USING btree ("recipe_version_id");--> statement-breakpoint
CREATE INDEX "equipment_aliases_idx" ON "equipment" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "equipment_items_owner_user_idx" ON "equipment_items" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "equipment_items_owner_brewery_idx" ON "equipment_items" USING btree ("owner_brewery_id");--> statement-breakpoint
CREATE INDEX "fermentables_aliases_idx" ON "fermentables" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "hops_aliases_idx" ON "hops" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "inventory_items_owner_user_idx" ON "inventory_items" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "inventory_items_owner_brewery_idx" ON "inventory_items" USING btree ("owner_brewery_id");--> statement-breakpoint
CREATE INDEX "memberships_user_id_index" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "miscs_aliases_idx" ON "miscs" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "notes_owner_user_idx" ON "notes" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "notes_owner_brewery_idx" ON "notes" USING btree ("owner_brewery_id");--> statement-breakpoint
CREATE INDEX "notes_recipe_id_index" ON "notes" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "notes_batch_id_index" ON "notes" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "readings_batch_id_taken_at_index" ON "readings" USING btree ("batch_id","taken_at");--> statement-breakpoint
CREATE INDEX "recipes_owner_user_idx" ON "recipes" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "recipes_owner_brewery_idx" ON "recipes" USING btree ("owner_brewery_id");--> statement-breakpoint
CREATE INDEX "shares_to_user_id_index" ON "shares" USING btree ("to_user_id");--> statement-breakpoint
CREATE INDEX "shares_to_brewery_id_index" ON "shares" USING btree ("to_brewery_id");--> statement-breakpoint
CREATE INDEX "styles_aliases_idx" ON "styles" USING gin ("aliases");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "water_profiles_aliases_idx" ON "water_profiles" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "yeasts_aliases_idx" ON "yeasts" USING gin ("aliases");