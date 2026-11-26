-- Hand-written. Equipment still held by someone who left its brewery before 0010's trigger
-- existed goes back to the brewery. Loans to current members, and equipment of other breweries
-- that person still belongs to, are left alone.
UPDATE equipment_items e SET held_by_user_id = NULL
WHERE e.owner_brewery_id IS NOT NULL
  AND e.held_by_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.brewery_id = e.owner_brewery_id AND m.user_id = e.held_by_user_id
  );
