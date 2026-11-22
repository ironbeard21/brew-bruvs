-- Reverses 0003_recipe_guards.sql. Hand-written; keep in step with the up migration.
DROP TRIGGER "recipe_versions_immutable" ON "recipe_versions";
DROP FUNCTION "recipe_versions_immutable"();
DROP TRIGGER "recipes_keep_credit" ON "recipes";
DROP FUNCTION "recipes_keep_credit"();
