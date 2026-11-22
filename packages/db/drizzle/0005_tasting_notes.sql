CREATE TYPE "public"."note_kind" AS ENUM('general', 'tasting');--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "kind" "note_kind" DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "score_aroma" integer;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "score_appearance" integer;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "score_flavor" integer;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "score_mouthfeel" integer;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "score_overall" integer;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_scores_only_tasting" CHECK ("notes"."kind" = 'tasting' OR num_nonnulls("notes"."score_aroma", "notes"."score_appearance", "notes"."score_flavor", "notes"."score_mouthfeel", "notes"."score_overall") = 0);--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_scores_range" CHECK (("score_aroma" BETWEEN 0 AND 12) AND ("score_appearance" BETWEEN 0 AND 3) AND ("score_flavor" BETWEEN 0 AND 20) AND ("score_mouthfeel" BETWEEN 0 AND 5) AND ("score_overall" BETWEEN 0 AND 10));