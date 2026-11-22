// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from "node:fs/promises";
import { units } from "@brew-bruvs/brew-math";
import { schema } from "@brew-bruvs/db";
import { getTableColumns, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const tables = {
  hops: schema.hops,
  fermentables: schema.fermentables,
  yeasts: schema.yeasts,
  miscs: schema.miscs,
  styles: schema.styles,
  water_profiles: schema.waterProfiles,
  equipment: schema.equipment,
};

type Catalog = keyof typeof tables;
type SourceRow = Record<string, string | number> & {
  id: string;
  aliases: string;
  sources: string;
  licenses: string;
};
type SeedData = {
  sources: Record<string, { license: string }>;
  catalog: Record<Catalog, SourceRow[]>;
};

const openLicenses = new Set(["CC-BY-SA-4.0", "CC0-1.0", "GPL-3.0", "MIT"]);
const splitList = (value: string) =>
  value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

function toDatabaseRow(row: SourceRow, catalog: Catalog, sourceRegistry: SeedData["sources"]) {
  const record: Record<string, string | number | string[] | null> = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value === "" ? null : value]),
  );
  const sources = splitList(row.sources);
  const licenses = splitList(row.licenses);
  if (
    !sources.length ||
    !licenses.length ||
    licenses.some((license) => !openLicenses.has(license)) ||
    sources.some((source) => !licenses.includes(sourceRegistry[source]?.license ?? ""))
  ) {
    throw new Error(`Catalog row ${row.id} lacks open-license provenance`);
  }
  record.aliases = splitList(row.aliases);
  record.sources = sources;
  record.licenses = licenses;
  if (typeof row.beverages === "string") record.beverages = splitList(row.beverages);

  if (catalog === "styles") {
    record.notes = null;
    record.color_ebc_min =
      typeof row.color_srm_min === "number" ? units.srmToEbc(row.color_srm_min) : null;
    record.color_ebc_max =
      typeof row.color_srm_max === "number" ? units.srmToEbc(row.color_srm_max) : null;
  }
  if (catalog === "fermentables") {
    record.potential_sg =
      typeof row.potential_ppg === "number" ? units.ppgToPotentialSg(row.potential_ppg) : null;
  }
  return record;
}

export async function importCatalog(db: NodePgDatabase) {
  const input = await readFile(new URL("../data/catalog.json", import.meta.url), "utf8");
  const { catalog, sources } = JSON.parse(input) as SeedData;

  return db.transaction(async (tx) => {
    let changed = 0;
    for (const name of Object.keys(tables) as Catalog[]) {
      const table = tables[name];
      const rows = catalog[name].map((row) => toDatabaseRow(row, name, sources));
      const columns = Object.values(getTableColumns(table)).map(({ name }) => name);
      const fields = sql.join(columns.map(sql.identifier), sql`, `);
      const updates = sql.join(
        columns
          .filter((column) => column !== "id")
          .map((column) => {
            const field = sql.identifier(column);
            return sql`${field} = excluded.${field}`;
          }),
        sql`, `,
      );
      const result = await tx.execute(sql`
        INSERT INTO ${table} AS existing (${fields})
        SELECT ${fields} FROM jsonb_populate_recordset(NULL::${table}, ${JSON.stringify(rows)}::jsonb)
        ON CONFLICT (id) DO UPDATE SET ${updates}
        WHERE existing IS DISTINCT FROM excluded
      `);
      changed += result.rowCount ?? 0;
    }
    return changed;
  });
}

export async function findCatalogMatches(db: NodePgDatabase, catalog: Catalog, search: string) {
  const term = search.trim();
  if (!term) return [];

  const table = tables[catalog];
  return db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(sql`
    strpos(lower(${table.name}), lower(${term})) > 0 OR EXISTS (
      SELECT FROM unnest(${table.aliases}) AS alias(name)
      WHERE strpos(lower(alias.name), lower(${term})) > 0
    )
  `)
    .orderBy(table.name, table.id);
}
