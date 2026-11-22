-- Reverses 0004_account_hardening.sql. Hand-written; keep in step with the up migration.
ALTER TABLE "users" DROP COLUMN "disabled_at";
DROP TABLE "password_resets";
