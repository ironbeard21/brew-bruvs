-- Row-level security (ADR-0011). Hand-written: Postgres policies that mirror can() in
-- apps/server/src/permissions.ts: owner → brewery role → explicit share → visibility.
--
-- The server runs as `brew_app`, which has no BYPASSRLS. Per connection checkout it sets
-- `app.user_id` (empty for anonymous visitors); brewery roles are read from `memberships` by the
-- functions below, so the database never trusts a role list the server passes in. Migrations,
-- the catalog import and jobs run as the owning role, which policies don't apply to.
-- Unlisted rows are readable by id here, as in can(); keeping them out of lists stays in the API.

-- An administrator can create brew_app beforehand (managed databases); then this needs no
-- CREATEROLE. Membership only matters when the server switches to it with SET ROLE.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brew_app') THEN
    CREATE ROLE brew_app NOLOGIN;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END $$;
DO $$ BEGIN
  IF NOT pg_has_role(current_user, 'brew_app', 'MEMBER') THEN
    EXECUTE format('GRANT brew_app TO %I', current_user);
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'brew_app is not granted to %; the server must sign in as brew_app', current_user;
END $$;

GRANT USAGE ON SCHEMA public TO brew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO brew_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO brew_app;

CREATE SCHEMA app;
GRANT USAGE ON SCHEMA app TO brew_app;

-- ── Who is asking ─────────────────────────────────────────────────────

CREATE FUNCTION app.user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION app.role_in(p_brewery uuid) RETURNS brewery_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.role FROM memberships m WHERE m.brewery_id = p_brewery AND m.user_id = app.user_id()
$$;

-- ROLE_ACTIONS in permissions.ts.
CREATE FUNCTION app.role_allows(p_role brewery_role, p_action text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN p_action IN ('read', 'contribute', 'edit', 'delete', 'share')
    WHEN 'brewer' THEN p_action IN ('read', 'contribute', 'edit')
    WHEN 'member' THEN p_action IN ('read', 'contribute')
    WHEN 'viewer' THEN p_action = 'read'
    ELSE false
  END
$$;

-- can() for one row whose owner and visibility the caller already has.
CREATE FUNCTION app.can(
  p_action text,
  p_kind shareable_type,
  p_id uuid,
  p_owner_user uuid,
  p_owner_brewery uuid,
  p_visibility visibility
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  uid uuid := app.user_id();
BEGIN
  IF uid IS NOT NULL THEN
    IF p_owner_user = uid THEN RETURN true; END IF;
    IF p_owner_brewery IS NOT NULL
      AND app.role_allows(app.role_in(p_owner_brewery), p_action) THEN
      RETURN true;
    END IF;
    IF EXISTS (
      SELECT 1 FROM shares s
      WHERE s.resource_type = p_kind AND s.resource_id = p_id
        -- SHARE_ACTIONS: read → read; edit → read, contribute, edit.
        AND (p_action = 'read' OR (s.level = 'edit' AND p_action IN ('contribute', 'edit')))
        AND (s.to_user_id = uid
          OR (s.to_brewery_id IS NOT NULL
            AND app.role_allows(app.role_in(s.to_brewery_id), p_action)))
    ) THEN
      RETURN true;
    END IF;
  END IF;
  RETURN p_action = 'read'
    AND (p_visibility IN ('public', 'unlisted') OR (p_visibility = 'server' AND uid IS NOT NULL));
END
$$;

-- can() for a row given by type and id, for child tables and shares.
CREATE FUNCTION app.can_on(p_action text, p_kind shareable_type, p_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  n integer;
BEGIN
  EXECUTE format(
    'SELECT owner_user_id, owner_brewery_id, visibility FROM %I WHERE id = $1',
    CASE p_kind
      WHEN 'recipe' THEN 'recipes'
      WHEN 'batch' THEN 'batches'
      WHEN 'note' THEN 'notes'
      WHEN 'inventory_item' THEN 'inventory_items'
      WHEN 'equipment_item' THEN 'equipment_items'
      WHEN 'equipment_profile' THEN 'equipment_profiles'
    END
  ) INTO r USING p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN false; END IF;
  RETURN app.can(p_action, p_kind, p_id, r.owner_user_id, r.owner_brewery_id, r.visibility);
END
$$;

-- A batch status move reserves, uses and gives back its owner's stock on behalf of whoever may
-- edit the batch. The server names the batch in `app.batch_id` for that transaction only.
CREATE FUNCTION app.batch_stock(p_owner_user uuid, p_owner_brewery uuid, p_item uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  bid uuid := nullif(current_setting('app.batch_id', true), '')::uuid;
  b record;
BEGIN
  IF bid IS NULL THEN RETURN false; END IF;
  SELECT owner_user_id, owner_brewery_id, visibility INTO b FROM batches WHERE id = bid;
  IF NOT FOUND
    OR NOT app.can('edit', 'batch', bid, b.owner_user_id, b.owner_brewery_id, b.visibility) THEN
    RETURN false;
  END IF;
  RETURN (p_owner_user IS NOT DISTINCT FROM b.owner_user_id
      AND p_owner_brewery IS NOT DISTINCT FROM b.owner_brewery_id)
    OR EXISTS (
      SELECT 1 FROM inventory_reservations r
      WHERE r.batch_id = bid AND r.inventory_item_id = p_item
    );
END
$$;

-- Policies can't see the old row, so a trigger checks two changes for the server's role:
-- only the personal owner may move an object to another owner (moveToBrewery), and changing
-- visibility needs "share" on the row as it was. TG_ARGV[0] is the shareable type.
CREATE FUNCTION app.guard_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'brew_app' THEN
    IF (NEW.owner_user_id, NEW.owner_brewery_id)
        IS DISTINCT FROM (OLD.owner_user_id, OLD.owner_brewery_id)
      AND OLD.owner_user_id IS DISTINCT FROM app.user_id() THEN
      RAISE EXCEPTION 'only its owner can move this' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.visibility IS DISTINCT FROM OLD.visibility
      AND NOT app.can('share', TG_ARGV[0]::shareable_type, OLD.id,
        OLD.owner_user_id, OLD.owner_brewery_id, OLD.visibility) THEN
      RAISE EXCEPTION 'changing who can see this needs share'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- What started batches hold of an item, counting holds the caller can't see (other people's
-- private batches), so stock is never promised twice. Only for an item the caller may read or
-- is working with for a batch.
CREATE FUNCTION app.reserved(p_item uuid, p_owner_user uuid, p_owner_brewery uuid)
RETURNS double precision
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (app.can_on('read', 'inventory_item', p_item)
    OR app.batch_stock(p_owner_user, p_owner_brewery, p_item)) THEN
    RETURN 0;
  END IF;
  RETURN coalesce((
    SELECT sum(r.quantity) FROM inventory_reservations r
    WHERE r.inventory_item_id = p_item AND r.state = 'reserved'
  ), 0);
END
$$;

-- What a batch holds, with only the lot fields a reader of the batch needs (name, unit, catalog
-- id, alpha acid): batch readers may not be able to read the inventory itself.
CREATE FUNCTION app.batch_lots(p_batch uuid)
RETURNS TABLE (
  id uuid,
  item_id uuid,
  quantity double precision,
  state reservation_state,
  created_at timestamptz,
  name text,
  unit quantity_unit,
  catalog_id text,
  alpha_acid_pct double precision
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app.can_on('read', 'batch', p_batch) THEN RETURN; END IF;
  RETURN QUERY
    SELECT r.id, r.inventory_item_id, r.quantity, r.state, r.created_at,
      i.name, i.quantity_unit, i.catalog_id, i.alpha_acid_pct
    FROM inventory_reservations r JOIN inventory_items i ON i.id = r.inventory_item_id
    WHERE r.batch_id = p_batch
    ORDER BY r.created_at, r.id;
END
$$;

-- A feed event about a batch (its status change, a reading, the batch itself) may be written by
-- anyone who may contribute to that batch, member of its brewery or not.
CREATE FUNCTION app.activity_allowed(p_brewery uuid, p_type text, p_object uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  bid uuid;
BEGIN
  bid := CASE p_type
    WHEN 'batch' THEN p_object
    WHEN 'reading' THEN (SELECT batch_id FROM readings WHERE id = p_object)
    WHEN 'batch_status_change' THEN (SELECT batch_id FROM batch_status_changes WHERE id = p_object)
  END;
  RETURN bid IS NOT NULL
    AND EXISTS (SELECT 1 FROM batches b WHERE b.id = bid AND b.owner_brewery_id = p_brewery)
    AND app.can_on('contribute', 'batch', bid);
END
$$;

-- Queues a batch event for the webhooks of the batch's owner (P2-08). Webhook settings are
-- private to whoever manages them, so queueing goes through here: a signed-in caller must be
-- able to contribute to the batch (a brewery Member's reading still reaches the brewery's
-- webhooks); with no user it is device ingest or the jobs worker.
CREATE FUNCTION app.queue_batch_webhooks(
  p_batch uuid,
  p_type text,
  p_occurred_at text,
  p_data jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  b record;
BEGIN
  IF app.user_id() IS NOT NULL AND NOT app.can_on('contribute', 'batch', p_batch) THEN
    RAISE EXCEPTION 'not allowed to report on this batch' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT owner_user_id, owner_brewery_id INTO b FROM batches WHERE id = p_batch;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO webhook_jobs (integration_id, event)
  SELECT i.id, jsonb_build_object(
      'type', p_type, 'batchId', p_batch, 'occurredAt', p_occurred_at, 'data', p_data)
  FROM integrations i
  WHERE i.kind = 'webhook_out'
    AND i.owner_user_id IS NOT DISTINCT FROM b.owner_user_id
    AND i.owner_brewery_id IS NOT DISTINCT FROM b.owner_brewery_id
    AND ((i.batch_id IS NULL AND i.config->>'batchScoped' IS DISTINCT FROM 'true')
      OR i.batch_id = p_batch)
  FOR KEY SHARE OF i;
END
$$;

-- Devices post readings with a token and no user. These two functions are the whole of what a
-- token allows: see its device, and add a reading to its batch while the device and batch
-- still belong to the same owner.
CREATE FUNCTION app.device_for_token(p_token_hash text)
RETURNS TABLE (kind integration_kind, config jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.kind, i.config FROM integrations i JOIN batches b ON b.id = i.batch_id
  WHERE i.token_hash = p_token_hash AND i.kind IN ('ispindel', 'tilt', 'rapt')
    AND i.owner_user_id IS NOT DISTINCT FROM b.owner_user_id
    AND i.owner_brewery_id IS NOT DISTINCT FROM b.owner_brewery_id
$$;

CREATE FUNCTION app.record_device_reading(
  p_token_hash text,
  p_gravity_sg double precision,
  p_temperature_c double precision,
  p_taken_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d record;
  rid uuid;
BEGIN
  SELECT i.id, i.batch_id, b.owner_brewery_id INTO d
  FROM integrations i JOIN batches b ON b.id = i.batch_id
  WHERE i.token_hash = p_token_hash AND i.kind IN ('ispindel', 'tilt', 'rapt')
    AND i.owner_user_id IS NOT DISTINCT FROM b.owner_user_id
    AND i.owner_brewery_id IS NOT DISTINCT FROM b.owner_brewery_id
  FOR SHARE OF b FOR UPDATE OF i;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO readings (batch_id, taken_at, gravity_sg, temperature_c, source)
  VALUES (d.batch_id, p_taken_at, p_gravity_sg, p_temperature_c, 'device')
  RETURNING id INTO rid;
  IF d.owner_brewery_id IS NOT NULL THEN
    INSERT INTO activity_events (brewery_id, actor_user_id, verb, object_type, object_id)
    VALUES (d.owner_brewery_id, NULL, 'reading_logged', 'reading', rid);
  END IF;
  PERFORM app.queue_batch_webhooks(
    d.batch_id,
    'reading.logged',
    to_char(p_taken_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    jsonb_build_object(
      'id', rid,
      'takenAt', to_char(p_taken_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'gravitySg', p_gravity_sg,
      'temperatureC', p_temperature_c,
      'source', 'device'
    )
  );
  UPDATE integrations SET last_seen_at = p_taken_at WHERE id = d.id;
  RETURN rid;
END
$$;

-- ── Owned objects ─────────────────────────────────────────────────────

DO $$
DECLARE
  t record;
  can_row text;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('recipes', 'recipe'),
      ('batches', 'batch'),
      ('notes', 'note'),
      ('inventory_items', 'inventory_item'),
      ('equipment_items', 'equipment_item'),
      ('equipment_profiles', 'equipment_profile')
    ) AS v(tbl, kind)
  LOOP
    can_row := format(
      'app.can(%%L, %L, id, owner_user_id, owner_brewery_id, visibility)', t.kind);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (%s)',
      t.tbl || '_read', t.tbl, format(can_row, 'read'));
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (owner_user_id = app.user_id()'
        || ' OR app.role_allows(app.role_in(owner_brewery_id), %L))',
      t.tbl || '_add', t.tbl, 'edit');
    -- Visibility changes need "share"; everything else needs "edit".
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (%s OR %s) WITH CHECK (%s OR %s)',
      t.tbl || '_change', t.tbl,
      format(can_row, 'edit'), format(can_row, 'share'),
      format(can_row, 'edit'), format(can_row, 'share'));
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (%s)',
      t.tbl || '_remove', t.tbl, format(can_row, 'delete'));
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OF owner_user_id, owner_brewery_id, visibility ON %I'
        || ' FOR EACH ROW EXECUTE FUNCTION app.guard_change(%L)',
      t.tbl || '_guard_change', t.tbl, t.kind);
  END LOOP;
END $$;

-- A batch's status move works with its owner's stock (app.batch_stock).
CREATE POLICY inventory_items_batch_read ON inventory_items FOR SELECT
  USING (app.batch_stock(owner_user_id, owner_brewery_id, id));
CREATE POLICY inventory_items_batch_change ON inventory_items FOR UPDATE
  USING (app.batch_stock(owner_user_id, owner_brewery_id, id))
  WITH CHECK (app.batch_stock(owner_user_id, owner_brewery_id, id));

-- ── Things that belong to a recipe or batch ───────────────────────────

ALTER TABLE recipe_versions ENABLE ROW LEVEL SECURITY;
-- Readable with the recipe, or through a batch made from it that you can read.
CREATE POLICY recipe_versions_read ON recipe_versions FOR SELECT USING (
  app.can_on('read', 'recipe', recipe_id)
  OR EXISTS (SELECT 1 FROM batches b WHERE b.recipe_version_id = recipe_versions.id)
);
CREATE POLICY recipe_versions_add ON recipe_versions FOR INSERT
  WITH CHECK (app.can_on('edit', 'recipe', recipe_id));

ALTER TABLE batch_status_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY batch_status_changes_read ON batch_status_changes FOR SELECT
  USING (app.can_on('read', 'batch', batch_id));
CREATE POLICY batch_status_changes_add ON batch_status_changes FOR INSERT
  WITH CHECK (app.can_on('edit', 'batch', batch_id));

ALTER TABLE readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY readings_read ON readings FOR SELECT USING (app.can_on('read', 'batch', batch_id));
CREATE POLICY readings_add ON readings FOR INSERT
  WITH CHECK (app.can_on('contribute', 'batch', batch_id));
-- Contributors change their own readings; anyone else's needs edit.
CREATE POLICY readings_change ON readings FOR UPDATE
  USING (app.can_on('edit', 'batch', batch_id)
    OR (created_by_user_id = app.user_id() AND app.can_on('contribute', 'batch', batch_id)))
  WITH CHECK (app.can_on('edit', 'batch', batch_id)
    OR (created_by_user_id = app.user_id() AND app.can_on('contribute', 'batch', batch_id)));
CREATE POLICY readings_remove ON readings FOR DELETE
  USING (app.can_on('edit', 'batch', batch_id)
    OR (created_by_user_id = app.user_id() AND app.can_on('contribute', 'batch', batch_id)));

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY reminders_read ON reminders FOR SELECT USING (app.can_on('read', 'batch', batch_id));
CREATE POLICY reminders_add ON reminders FOR INSERT
  WITH CHECK (app.can_on('edit', 'batch', batch_id));
CREATE POLICY reminders_change ON reminders FOR UPDATE
  USING (app.can_on('edit', 'batch', batch_id))
  WITH CHECK (app.can_on('edit', 'batch', batch_id));
CREATE POLICY reminders_remove ON reminders FOR DELETE
  USING (app.can_on('edit', 'batch', batch_id));

ALTER TABLE inventory_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_reservations_read ON inventory_reservations FOR SELECT
  USING (app.can_on('read', 'batch', batch_id)
    OR app.can_on('read', 'inventory_item', inventory_item_id));
CREATE POLICY inventory_reservations_add ON inventory_reservations FOR INSERT
  WITH CHECK (app.can_on('edit', 'batch', batch_id));
CREATE POLICY inventory_reservations_change ON inventory_reservations FOR UPDATE
  USING (app.can_on('edit', 'batch', batch_id))
  WITH CHECK (app.can_on('edit', 'batch', batch_id));

-- ── Shares, integrations, activity ────────────────────────────────────

ALTER TABLE shares ENABLE ROW LEVEL SECURITY;
-- Your own shares and your breweries', plus every share of something you may share.
CREATE POLICY shares_read ON shares FOR SELECT USING (
  to_user_id = app.user_id()
  OR app.role_in(to_brewery_id) IS NOT NULL
  OR app.can_on('share', resource_type, resource_id)
);
CREATE POLICY shares_add ON shares FOR INSERT
  WITH CHECK (app.can_on('share', resource_type, resource_id));
CREATE POLICY shares_change ON shares FOR UPDATE
  USING (app.can_on('share', resource_type, resource_id))
  WITH CHECK (app.can_on('share', resource_type, resource_id));
CREATE POLICY shares_remove ON shares FOR DELETE
  USING (app.can_on('share', resource_type, resource_id));

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY integrations_own ON integrations
  USING (owner_user_id = app.user_id()
    OR app.role_allows(app.role_in(owner_brewery_id), 'edit'))
  WITH CHECK (owner_user_id = app.user_id()
    OR app.role_allows(app.role_in(owner_brewery_id), 'edit'));

-- Delivery jobs belong to their webhook: seen and test-queued by whoever manages it. Events are
-- queued through app.queue_batch_webhooks; the worker runs as the owner.
ALTER TABLE webhook_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_jobs_read ON webhook_jobs FOR SELECT
  USING (EXISTS (SELECT 1 FROM integrations i WHERE i.id = integration_id));
CREATE POLICY webhook_jobs_add ON webhook_jobs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM integrations i WHERE i.id = integration_id));

ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY activity_events_read ON activity_events FOR SELECT
  USING (app.role_in(brewery_id) IS NOT NULL);
CREATE POLICY activity_events_add ON activity_events FOR INSERT
  WITH CHECK (actor_user_id = app.user_id() AND (app.role_in(brewery_id) IS NOT NULL
    OR app.activity_allowed(brewery_id, object_type, object_id)));
