-- Reverses 0011_return_stale_holdings.sql. Hand-written; keep in step with the up migration.
-- Nothing to undo: the up migration only returned stale loans, and who held them isn't kept.
SELECT 1;
