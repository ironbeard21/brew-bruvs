-- Reverses 0005_tasting_notes.sql. Hand-written; keep in step with the up migration.
-- Tasting notes keep their text and become general notes; their scores are dropped.
ALTER TABLE "notes" DROP CONSTRAINT "notes_scores_range";
ALTER TABLE "notes" DROP CONSTRAINT "notes_scores_only_tasting";
ALTER TABLE "notes" DROP COLUMN "score_overall";
ALTER TABLE "notes" DROP COLUMN "score_mouthfeel";
ALTER TABLE "notes" DROP COLUMN "score_flavor";
ALTER TABLE "notes" DROP COLUMN "score_appearance";
ALTER TABLE "notes" DROP COLUMN "score_aroma";
ALTER TABLE "notes" DROP COLUMN "kind";
DROP TYPE "public"."note_kind";
