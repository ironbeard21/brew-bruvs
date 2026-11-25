CREATE TABLE "brewery_invites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"brewery_id" uuid NOT NULL,
	"role" "brewery_role" NOT NULL,
	"to_user_id" uuid,
	"code_hash" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "brewery_invites_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "brewery_invites_one_target" CHECK (num_nonnulls("brewery_invites"."to_user_id", "brewery_invites"."code_hash") = 1)
);
--> statement-breakpoint
ALTER TABLE "brewery_invites" ADD CONSTRAINT "brewery_invites_brewery_id_breweries_id_fk" FOREIGN KEY ("brewery_id") REFERENCES "public"."breweries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brewery_invites" ADD CONSTRAINT "brewery_invites_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brewery_invites" ADD CONSTRAINT "brewery_invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brewery_invites_brewery_id_index" ON "brewery_invites" USING btree ("brewery_id");--> statement-breakpoint
CREATE INDEX "brewery_invites_to_user_id_index" ON "brewery_invites" USING btree ("to_user_id");