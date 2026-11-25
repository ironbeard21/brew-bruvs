-- Reverses 0010_release_hardening.sql. Hand-written; keep in step with the up migration.
DROP TRIGGER memberships_return_holdings ON memberships;
DROP FUNCTION app.return_holdings();
ALTER TABLE "inventory_items" DROP CONSTRAINT "inventory_items_quantity_nonneg";
ALTER TABLE "inventory_items" DROP CONSTRAINT "inventory_items_low_stock_nonneg";
ALTER TABLE "inventory_reservations" DROP CONSTRAINT "inventory_reservations_quantity_positive";
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_quantity_nonneg" CHECK ("inventory_items"."quantity" >= 0);
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_low_stock_nonneg" CHECK ("inventory_items"."low_stock_threshold" >= 0);
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_quantity_positive" CHECK ("inventory_reservations"."quantity" > 0);
