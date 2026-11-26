// SPDX-License-Identifier: AGPL-3.0-or-later
// Database schema v3. Units are SI (kg, L, °C) and specific gravity; colour is EBC.
// User data uses UUIDv7 ids (Postgres 18 `uuidv7()`); catalog rows keep their seed ids.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const beverage = pgEnum("beverage", ["beer", "mead", "wine", "cider"]);
// unlisted: anyone with the link can view; never in search or feeds.
export const visibility = pgEnum("visibility", ["private", "unlisted", "server", "public"]);
// owner: everything, and there can be several · brewer: edits brewery recipes and batches ·
// member: logs readings and notes on brewery batches · viewer: reads.
export const breweryRole = pgEnum("brewery_role", ["owner", "brewer", "member", "viewer"]);
export const shareLevel = pgEnum("share_level", ["read", "edit"]);
export const shareableType = pgEnum("shareable_type", [
  "recipe",
  "batch",
  "inventory_item",
  "equipment_item",
  "note",
  "equipment_profile",
]);
export const quantityUnit = pgEnum("quantity_unit", ["kg", "l", "each"]);
// session: web cookie · app: phone sign-in · personal: scoped API token
export const tokenKind = pgEnum("token_kind", ["session", "app", "personal"]);
export const unitSystem = pgEnum("unit_system", ["us", "metric"]);
// One list for every beverage; a check on `batches` limits each beverage to its own flow.
export const batchStatus = pgEnum("batch_status", [
  "planned",
  "brewing",
  "fermenting",
  "conditioning",
  "packaged",
  "primary",
  "secondary",
  "bulk_aging",
  "stabilized",
  "bottled",
  "bottle_aging",
  "finished",
]);
export const BEER_STATUSES = [
  "planned",
  "brewing",
  "fermenting",
  "conditioning",
  "packaged",
  "finished",
] as const;
// Mead, wine and cider.
export const AGED_STATUSES = [
  "planned",
  "primary",
  "secondary",
  "bulk_aging",
  "stabilized",
  "bottled",
  "bottle_aging",
  "finished",
] as const;
export const noteKind = pgEnum("note_kind", ["general", "tasting"]);
// BJCP score sheet maximums (beer sheet; also used here for mead, wine and cider).
export const TASTING_SCORE_MAX = {
  aroma: 12,
  appearance: 3,
  flavor: 20,
  mouthfeel: 5,
  overall: 10,
} as const;
export const readingSource = pgEnum("reading_source", ["manual", "device"]);
export const reservationState = pgEnum("reservation_state", ["reserved", "used", "released"]);
export const equipmentCondition = pgEnum("equipment_condition", [
  "new",
  "good",
  "worn",
  "needs_repair",
  "retired",
]);
// Devices post readings to a URL with a secret token; webhook_out sends batch events out.
export const integrationKind = pgEnum("integration_kind", [
  "ispindel",
  "gravitymon",
  "tilt",
  "rapt",
  "webhook_out",
]);
export const reminderKind = pgEnum("reminder_kind", [
  "nutrient",
  "rack",
  "sulfite",
  "taste",
  "ready",
  "custom",
]);

const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ── People and breweries ──────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: id(),
    uri: text("uri").notNull().unique(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    // Privacy rule: location is city and state only.
    city: text("city"),
    state: text("state"),
    isAdmin: boolean("is_admin").notNull().default(false),
    // Display units only; everything is stored in SI.
    units: unitSystem("units").notNull().default("us"),
    // Null for accounts that only sign in through OIDC.
    passwordHash: text("password_hash"),
    oidcIssuer: text("oidc_issuer"),
    oidcSubject: text("oidc_subject"),
    // Set by an admin: the account can't sign in and its tokens stop working.
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_lower_key").on(sql`lower(${t.email})`),
    unique("users_oidc_key").on(t.oidcIssuer, t.oidcSubject),
  ],
);

// Only SHA-256 hashes of tokens are stored; the token itself is shown once.
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: tokenKind("kind").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    name: text("name"),
    scopes: text("scopes").array().notNull().default(sql`'{}'`),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index().on(t.userId)],
);

export const invites = pgTable("invites", {
  id: id(),
  codeHash: text("code_hash").notNull().unique(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedByUserId: uuid("used_by_user_id").references(() => users.id, { onDelete: "set null" }),
});

// One-time password reset links an admin creates for a user (there is no email). Hash only.
export const passwordResets = pgTable(
  "password_resets",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index().on(t.userId)],
);

export const breweries = pgTable("breweries", {
  id: id(),
  uri: text("uri").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  city: text("city"),
  state: text("state"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    breweryId: uuid("brewery_id")
      .notNull()
      .references(() => breweries.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: breweryRole("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.breweryId, t.userId] }), index().on(t.userId)],
);

// An invitation into a brewery: to an email address, or a one-time code (hash only). An email
// invite is bound to the account that had the email when it was made, and only that account can
// see or accept it; with no such account it can never be accepted. The inviter is never told
// which, so inviting doesn't reveal who has an account.
export const breweryInvites = pgTable(
  "brewery_invites",
  {
    id: id(),
    breweryId: uuid("brewery_id")
      .notNull()
      .references(() => breweries.id, { onDelete: "cascade" }),
    role: breweryRole("role").notNull(),
    // Stored lower-case.
    email: text("email"),
    // Private: never returned to the inviter.
    toUserId: uuid("to_user_id").references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").unique(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    check("brewery_invites_one_target", sql`num_nonnulls(${t.email}, ${t.codeHash}) = 1`),
    index().on(t.breweryId),
    index().on(t.toUserId),
  ],
);

// Every shareable object has one owner (a user or a brewery), a global URI and a visibility.
const shareableColumns = () => ({
  id: id(),
  uri: text("uri").notNull().unique(),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "restrict" }),
  ownerBreweryId: uuid("owner_brewery_id").references(() => breweries.id, {
    onDelete: "restrict",
  }),
  visibility: visibility("visibility").notNull().default("private"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

const ownerChecks = (
  table: string,
  t: { ownerUserId: AnyPgColumn; ownerBreweryId: AnyPgColumn },
) => [
  check(`${table}_one_owner`, sql`num_nonnulls(${t.ownerUserId}, ${t.ownerBreweryId}) = 1`),
  index(`${table}_owner_user_idx`).on(t.ownerUserId),
  index(`${table}_owner_brewery_idx`).on(t.ownerBreweryId),
];

// ── Catalog (seed data; ids are the seed ids, e.g. "hop-citra") ─────

const catalogColumns = () => ({
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  aliases: text("aliases").array().notNull().default(sql`'{}'`),
  sources: text("sources").array().notNull(),
  licenses: text("licenses").array().notNull(),
  notes: text("notes"),
});
const beverages = () => beverage("beverages").array().notNull().default(sql`'{}'`);
const aliasIndex = (table: string, t: { aliases: AnyPgColumn }) =>
  index(`${table}_aliases_idx`).using("gin", t.aliases);

export const hops = pgTable(
  "hops",
  {
    ...catalogColumns(),
    origin: text("origin"),
    hopType: text("hop_type"),
    alphaAcidPct: doublePrecision("alpha_acid_pct"),
    alphaAcidMinPct: doublePrecision("alpha_acid_min_pct"),
    alphaAcidMaxPct: doublePrecision("alpha_acid_max_pct"),
    betaAcidPct: doublePrecision("beta_acid_pct"),
    cohumulonePct: doublePrecision("cohumulone_pct"),
    totalOilMlPer100g: doublePrecision("total_oil_ml_per_100g"),
    myrcenePct: doublePrecision("myrcene_pct"),
    humulenePct: doublePrecision("humulene_pct"),
    caryophyllenePct: doublePrecision("caryophyllene_pct"),
    farnesenePct: doublePrecision("farnesene_pct"),
    hsi: doublePrecision("hsi"),
    substitutes: text("substitutes"),
    beverages: beverages(),
  },
  (t) => [aliasIndex("hops", t)],
);

export const fermentables = pgTable(
  "fermentables",
  {
    ...catalogColumns(),
    fermentableType: text("fermentable_type"),
    producer: text("producer"),
    productId: text("product_id"),
    origin: text("origin"),
    category: text("category"),
    colorEbc: doublePrecision("color_ebc"),
    yieldPct: doublePrecision("yield_pct"),
    // Potential extract as specific gravity (BeerXML convention, e.g. 1.037).
    potentialSg: doublePrecision("potential_sg"),
    maxInBatchPct: doublePrecision("max_in_batch_pct"),
    diastaticPowerLintner: doublePrecision("diastatic_power_lintner"),
    proteinPct: doublePrecision("protein_pct"),
    moisturePct: doublePrecision("moisture_pct"),
    beverages: beverages(),
  },
  (t) => [aliasIndex("fermentables", t)],
);

export const yeasts = pgTable(
  "yeasts",
  {
    ...catalogColumns(),
    producer: text("producer"),
    productId: text("product_id"),
    yeastType: text("yeast_type"),
    form: text("form"),
    tempMinC: doublePrecision("temp_min_c"),
    tempMaxC: doublePrecision("temp_max_c"),
    attenuationMinPct: doublePrecision("attenuation_min_pct"),
    attenuationMaxPct: doublePrecision("attenuation_max_pct"),
    flocculation: text("flocculation"),
    alcoholTolerancePct: doublePrecision("alcohol_tolerance_pct"),
    bestFor: text("best_for"),
    beverages: beverages(),
  },
  (t) => [aliasIndex("yeasts", t)],
);

export const miscs = pgTable(
  "miscs",
  {
    ...catalogColumns(),
    miscType: text("misc_type"),
    waterAgentType: text("water_agent_type"),
    use: text("use"),
    useFor: text("use_for"),
    category: text("category"),
    beverages: beverages(),
  },
  (t) => [aliasIndex("miscs", t)],
);

export const styles = pgTable(
  "styles",
  {
    ...catalogColumns(),
    styleGuide: text("style_guide").notNull(),
    styleId: text("style_id"),
    category: text("category"),
    beverage: beverage("beverage").notNull(),
    ogMin: doublePrecision("og_min"),
    ogMax: doublePrecision("og_max"),
    fgMin: doublePrecision("fg_min"),
    fgMax: doublePrecision("fg_max"),
    ibuMin: doublePrecision("ibu_min"),
    ibuMax: doublePrecision("ibu_max"),
    colorEbcMin: doublePrecision("color_ebc_min"),
    colorEbcMax: doublePrecision("color_ebc_max"),
    abvMinPct: doublePrecision("abv_min_pct"),
    abvMaxPct: doublePrecision("abv_max_pct"),
    carbVolsMin: doublePrecision("carb_vols_min"),
    carbVolsMax: doublePrecision("carb_vols_max"),
  },
  (t) => [aliasIndex("styles", t)],
);

export const waterProfiles = pgTable(
  "water_profiles",
  {
    ...catalogColumns(),
    calciumPpm: doublePrecision("calcium_ppm"),
    magnesiumPpm: doublePrecision("magnesium_ppm"),
    sodiumPpm: doublePrecision("sodium_ppm"),
    sulfatePpm: doublePrecision("sulfate_ppm"),
    chloridePpm: doublePrecision("chloride_ppm"),
    bicarbonatePpm: doublePrecision("bicarbonate_ppm"),
  },
  (t) => [aliasIndex("water_profiles", t)],
);

const equipmentColumns = () => ({
  batchSizeL: doublePrecision("batch_size_l"),
  boilSizeL: doublePrecision("boil_size_l"),
  kettleVolumeL: doublePrecision("kettle_volume_l"),
  kettleLossL: doublePrecision("kettle_loss_l"),
  boilRateLPerHr: doublePrecision("boil_rate_l_per_hr"),
  mashTunVolumeL: doublePrecision("mash_tun_volume_l"),
  grainAbsorptionLPerKg: doublePrecision("grain_absorption_l_per_kg"),
});

export const equipment = pgTable(
  "equipment",
  { ...catalogColumns(), category: text("category"), ...equipmentColumns() },
  (t) => [aliasIndex("equipment", t)],
);

// ── Recipes and batches ───────────────────────────────────────────────

// A brewer's own equipment: scales recipes and sets volumes and efficiency.
// Seed rows in `equipment` are the catalog these can start from.
export const equipmentProfiles = pgTable(
  "equipment_profiles",
  {
    ...shareableColumns(),
    catalogId: text("catalog_id").references(() => equipment.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    ...equipmentColumns(),
    efficiencyPct: doublePrecision("efficiency_pct"),
    fermenterLossL: doublePrecision("fermenter_loss_l"),
  },
  (t) => [
    ...ownerChecks("equipment_profiles", t),
    check(
      "equipment_profiles_efficiency_range",
      sql`${t.efficiencyPct} > 0 AND ${t.efficiencyPct} <= 100`,
    ),
  ],
);

export const recipes = pgTable(
  "recipes",
  {
    ...shareableColumns(),
    name: text("name").notNull(),
    beverage: beverage("beverage").notNull(),
    // Credit for imported and forked recipes. Hard rule: once set it can never be changed or
    // removed (trigger recipes_keep_credit, migration 0003).
    creditSourceUrl: text("credit_source_url"),
    creditSite: text("credit_site"),
    creditAuthor: text("credit_author"),
    creditImportedAt: timestamp("credit_imported_at", { withTimezone: true }),
    creditLicense: text("credit_license"),
    forkedFromUri: text("forked_from_uri"),
    // Local link to the original; goes null if it is deleted, the URI above stays.
    forkedFromRecipeId: uuid("forked_from_recipe_id").references((): AnyPgColumn => recipes.id, {
      onDelete: "set null",
    }),
    // Set when the source's terms forbid reuse: the recipe can't be made public.
    publicSharingBlocked: boolean("public_sharing_blocked").notNull().default(false),
  },
  (t) => [...ownerChecks("recipes", t), index().on(t.forkedFromRecipeId)],
);

// Immutable: a change to a recipe writes a new version (trigger recipe_versions_immutable,
// migration 0003). The only update allowed is a reference going null when its target is deleted.
export const recipeVersions = pgTable(
  "recipe_versions",
  {
    id: id(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    beverage: beverage("beverage").notNull(),
    styleId: text("style_id").references(() => styles.id, { onDelete: "set null" }),
    batchSizeL: doublePrecision("batch_size_l").notNull(),
    equipmentProfileId: uuid("equipment_profile_id").references(() => equipmentProfiles.id, {
      onDelete: "set null",
    }),
    // Ingredients, mash and fermentation steps, shaped close to BeerJSON.
    content: jsonb("content").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.recipeId, t.version),
    check("recipe_versions_version_positive", sql`${t.version} > 0`),
  ],
);

export const batches = pgTable(
  "batches",
  {
    ...shareableColumns(),
    recipeVersionId: uuid("recipe_version_id")
      .notNull()
      .references(() => recipeVersions.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    beverage: beverage("beverage").notNull(),
    status: batchStatus("status").notNull().default("planned"),
    equipmentProfileId: uuid("equipment_profile_id").references(() => equipmentProfiles.id, {
      onDelete: "set null",
    }),
    batchSizeL: doublePrecision("batch_size_l"),
    brewedAt: timestamp("brewed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    ...ownerChecks("batches", t),
    index().on(t.recipeVersionId),
    check(
      "batches_status_fits_beverage",
      sql.raw(
        `("beverage" = 'beer' AND "status" IN (${BEER_STATUSES.map((s) => `'${s}'`).join(", ")}))` +
          ` OR ("beverage" <> 'beer' AND "status" IN (${AGED_STATUSES.map((s) => `'${s}'`).join(", ")}))`,
      ),
    ),
  ],
);

// Every status a batch has been in, for its timeline.
export const batchStatusChanges = pgTable(
  "batch_status_changes",
  {
    id: id(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    status: batchStatus("status").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [index().on(t.batchId, t.changedAt)],
);

export const readings = pgTable(
  "readings",
  {
    id: id(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    gravitySg: doublePrecision("gravity_sg"),
    temperatureC: doublePrecision("temperature_c"),
    ph: doublePrecision("ph"),
    brix: doublePrecision("brix"),
    titratableAcidityGPerL: doublePrecision("titratable_acidity_g_per_l"),
    freeSo2MgPerL: doublePrecision("free_so2_mg_per_l"),
    source: readingSource("source").notNull().default("manual"),
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.batchId, t.takenAt)],
);

// Scheduled batch tasks. The server stores them; the app turns them into local notifications.
export const reminders = pgTable(
  "reminders",
  {
    id: id(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    kind: reminderKind("kind").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    note: text("note"),
    webhookQueuedAt: timestamp("webhook_queued_at", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.batchId, t.dueAt)],
);

// ── Inventory, equipment, notes ───────────────────────────────────────

export const inventoryItems = pgTable(
  "inventory_items",
  {
    ...shareableColumns(),
    // Optional link to a catalog row by its seed id (e.g. "hop-citra").
    catalogId: text("catalog_id"),
    name: text("name").notNull(),
    quantity: doublePrecision("quantity").notNull(),
    quantityUnit: quantityUnit("quantity_unit").notNull(),
    lot: text("lot"),
    location: text("location"),
    // Hops: the alpha acid on this lot's label, which can override the recipe's.
    alphaAcidPct: doublePrecision("alpha_acid_pct"),
    purchasedOn: date("purchased_on"),
    bestBefore: date("best_before"),
    // In quantity_unit; the item is low on stock below it.
    lowStockThreshold: doublePrecision("low_stock_threshold"),
    // Swaps (Phase 4): how much of this item is offered. Unused until then.
    tradeable: boolean("tradeable").notNull().default(false),
    tradeableQuantity: doublePrecision("tradeable_quantity"),
    notes: text("notes"),
  },
  (t) => [
    ...ownerChecks("inventory_items", t),
    // `< 'Infinity'` also rejects NaN, which Postgres sorts above every number.
    check(
      "inventory_items_quantity_nonneg",
      sql`${t.quantity} >= 0 AND ${t.quantity} < 'Infinity'::float8`,
    ),
    check(
      "inventory_items_alpha_acid_range",
      sql`${t.alphaAcidPct} >= 0 AND ${t.alphaAcidPct} <= 100`,
    ),
    check(
      "inventory_items_low_stock_nonneg",
      sql`${t.lowStockThreshold} >= 0 AND ${t.lowStockThreshold} < 'Infinity'::float8`,
    ),
    check(
      "inventory_items_tradeable_quantity_range",
      sql`${t.tradeableQuantity} >= 0 AND ${t.tradeableQuantity} <= ${t.quantity}`,
    ),
  ],
);

// Ingredients a batch holds from an inventory item, in the item's unit.
// reserved when the batch starts · used when it is packaged or bottled · released otherwise.
export const inventoryReservations = pgTable(
  "inventory_reservations",
  {
    id: id(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    quantity: doublePrecision("quantity").notNull(),
    state: reservationState("state").notNull().default("reserved"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "inventory_reservations_quantity_positive",
      sql`${t.quantity} > 0 AND ${t.quantity} < 'Infinity'::float8`,
    ),
    index().on(t.batchId),
    index().on(t.inventoryItemId, t.state),
  ],
);

export const equipmentItems = pgTable(
  "equipment_items",
  {
    ...shareableColumns(),
    catalogId: text("catalog_id").references(() => equipment.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    // Free text such as "fermenter" or "kettle"; the catalog's categories are a guide.
    type: text("type"),
    condition: equipmentCondition("condition"),
    // Lending inside a brewery: who has it now.
    heldByUserId: uuid("held_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...equipmentColumns(),
    notes: text("notes"),
  },
  (t) => [...ownerChecks("equipment_items", t), index().on(t.heldByUserId)],
);

export const notes = pgTable(
  "notes",
  {
    ...shareableColumns(),
    recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id").references(() => batches.id, { onDelete: "cascade" }),
    kind: noteKind("kind").notNull().default("general"),
    body: text("body").notNull(),
    // Tasting notes only; each optional, out of TASTING_SCORE_MAX.
    scoreAroma: integer("score_aroma"),
    scoreAppearance: integer("score_appearance"),
    scoreFlavor: integer("score_flavor"),
    scoreMouthfeel: integer("score_mouthfeel"),
    scoreOverall: integer("score_overall"),
  },
  (t) => [
    ...ownerChecks("notes", t),
    check("notes_one_subject", sql`num_nonnulls(${t.recipeId}, ${t.batchId}) <= 1`),
    check(
      "notes_scores_only_tasting",
      sql`${t.kind} = 'tasting' OR num_nonnulls(${t.scoreAroma}, ${t.scoreAppearance}, ${t.scoreFlavor}, ${t.scoreMouthfeel}, ${t.scoreOverall}) = 0`,
    ),
    check(
      "notes_scores_range",
      sql.raw(
        Object.entries(TASTING_SCORE_MAX)
          .map(([k, max]) => `("score_${k}" BETWEEN 0 AND ${max})`)
          .join(" AND "),
      ),
    ),
    index().on(t.recipeId),
    index().on(t.batchId),
  ],
);

// ── Shares ────────────────────────────────────────────────────────────

export const shares = pgTable(
  "shares",
  {
    id: id(),
    resourceType: shareableType("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    toUserId: uuid("to_user_id").references(() => users.id, { onDelete: "cascade" }),
    toBreweryId: uuid("to_brewery_id").references(() => breweries.id, { onDelete: "cascade" }),
    level: shareLevel("level").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("shares_one_target", sql`num_nonnulls(${t.toUserId}, ${t.toBreweryId}) = 1`),
    unique("shares_target_key")
      .on(t.resourceType, t.resourceId, t.toUserId, t.toBreweryId)
      .nullsNotDistinct(),
    index().on(t.toUserId),
    index().on(t.toBreweryId),
  ],
);

// ── Integrations and activity ─────────────────────────────────────────

// Owned by a user or a brewery, not shared. Device tokens are stored as SHA-256 hashes only.
export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    ownerBreweryId: uuid("owner_brewery_id").references(() => breweries.id, {
      onDelete: "cascade",
    }),
    kind: integrationKind("kind").notNull(),
    name: text("name").notNull(),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    tokenHash: text("token_hash").unique(),
    batchId: uuid("batch_id").references(() => batches.id, { onDelete: "set null" }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("integrations_one_owner", sql`num_nonnulls(${t.ownerUserId}, ${t.ownerBreweryId}) = 1`),
    check(
      "integrations_device_token",
      sql`${t.kind} = 'webhook_out' OR ${t.tokenHash} IS NOT NULL`,
    ),
    index("integrations_owner_user_idx").on(t.ownerUserId),
    index("integrations_owner_brewery_idx").on(t.ownerBreweryId),
    index().on(t.batchId),
  ],
);

export const webhookJobs = pgTable(
  "webhook_jobs",
  {
    id: id(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    event: jsonb("event").$type<Record<string, unknown>>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
    failedAt: timestamp("failed_at", { withTimezone: true }),
  },
  (t) => [index().on(t.dueAt).where(sql`${t.failedAt} IS NULL`), index().on(t.integrationId)],
);

// A brewery's feed: "Ann moved Pale Ale to fermenting". Verbs are free text so tasks can add them.
export const activityEvents = pgTable(
  "activity_events",
  {
    id: id(),
    breweryId: uuid("brewery_id")
      .notNull()
      .references(() => breweries.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    verb: text("verb").notNull(),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.breweryId, t.at.desc())],
);
