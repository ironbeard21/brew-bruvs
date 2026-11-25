-- Generated constraint changes (finite inventory amounts), then a hand-written trigger.
ALTER TABLE "inventory_items" DROP CONSTRAINT "inventory_items_quantity_nonneg";--> statement-breakpoint
ALTER TABLE "inventory_items" DROP CONSTRAINT "inventory_items_low_stock_nonneg";--> statement-breakpoint
ALTER TABLE "inventory_reservations" DROP CONSTRAINT "inventory_reservations_quantity_positive";--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_quantity_nonneg" CHECK ("inventory_items"."quantity" >= 0 AND "inventory_items"."quantity" < 'Infinity'::float8);--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_low_stock_nonneg" CHECK ("inventory_items"."low_stock_threshold" >= 0 AND "inventory_items"."low_stock_threshold" < 'Infinity'::float8);--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_quantity_positive" CHECK ("inventory_reservations"."quantity" > 0 AND "inventory_reservations"."quantity" < 'Infinity'::float8);;--> statement-breakpoint
-- Leaving or being removed from a brewery gives back its equipment you hold. SECURITY DEFINER:
-- whoever leaves may not be allowed to edit the brewery's equipment under row-level security.
CREATE FUNCTION app.return_holdings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE equipment_items SET held_by_user_id = NULL
  WHERE owner_brewery_id = OLD.brewery_id AND held_by_user_id = OLD.user_id;
  RETURN OLD;
END
$$;--> statement-breakpoint
CREATE TRIGGER memberships_return_holdings AFTER DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION app.return_holdings();
