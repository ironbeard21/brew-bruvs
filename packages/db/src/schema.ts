// SPDX-License-Identifier: AGPL-3.0-or-later
// Database schema v1. Units are SI (kg, L, °C) and specific gravity; colour is EBC.
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
export const visibility = pgEnum("visibility", ["private", "server", "public"]);
export const breweryRole = pgEnum("brewery_role", ["owner", "admin", "brewer", "viewer"]);
export const shareLevel = pgEnum("share_level", ["read", "edit"]);
export const shareableType = pgEnum("shareable_type", [
  "recipe",
  "batch",
  "inventory_item",
  "equipment_item",
  "note",
]);
export const quantityUnit = pgEnum("quantity_unit", ["kg", "l", "each"]);
// session: web cookie · app: phone sign-in · personal: scoped API token
export const tokenKind = pgEnum("token_kind", ["session", "app", "personal"]);

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
    // Null for accounts that only sign in through OIDC.
    passwordHash: text("password_hash"),
    oidcIssuer: text("oidc_issuer"),
    oidcSubject: text("oidc_subject"),
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

export const breweries = pgTable("breweries", {
  id: id(),
  uri: text("uri").notNull().unique(),
  name: text("name").notNull(),
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

export const recipes = pgTable(
  "recipes",
  {
    ...shareableColumns(),
    name: text("name").notNull(),
    beverage: beverage("beverage").notNull(),
    // Credit for imported recipes. Hard rule: once set it can never be removed.
    creditSourceUrl: text("credit_source_url"),
    creditSite: text("credit_site"),
    creditAuthor: text("credit_author"),
  },
  (t) => ownerChecks("recipes", t),
);

// Immutable: a change to a recipe writes a new version.
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
    batchSizeL: doublePrecision("batch_size_l"),
    brewedAt: timestamp("brewed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [...ownerChecks("batches", t), index().on(t.recipeVersionId)],
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
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.batchId, t.takenAt)],
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
    bestBefore: date("best_before"),
    notes: text("notes"),
  },
  (t) => [
    ...ownerChecks("inventory_items", t),
    check("inventory_items_quantity_nonneg", sql`${t.quantity} >= 0`),
  ],
);

export const equipmentItems = pgTable(
  "equipment_items",
  {
    ...shareableColumns(),
    catalogId: text("catalog_id").references(() => equipment.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    ...equipmentColumns(),
    notes: text("notes"),
  },
  (t) => ownerChecks("equipment_items", t),
);

export const notes = pgTable(
  "notes",
  {
    ...shareableColumns(),
    recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id").references(() => batches.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
  },
  (t) => [
    ...ownerChecks("notes", t),
    check("notes_one_subject", sql`num_nonnulls(${t.recipeId}, ${t.batchId}) <= 1`),
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
