-- Reverses 0001_auth.sql. Hand-written; keep in step with the up migration.
ALTER TABLE "users" DROP CONSTRAINT "users_oidc_key";
ALTER TABLE "users" DROP COLUMN "oidc_subject";
ALTER TABLE "users" DROP COLUMN "oidc_issuer";
ALTER TABLE "users" DROP COLUMN "password_hash";
DROP TABLE "invites";
DROP TABLE "auth_tokens";
DROP TYPE "public"."token_kind";
