// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from "node:fs/promises";
import { units } from "@brew-bruvs/brew-math";
import { type CatalogName, catalogNameMatches, catalogTables as tables } from "@brew-bruvs/db";
import { getTableColumns, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

type SourceRow = Record<string, string | number> & {
  id: string;
  aliases: string;
  sources: string;
  licenses: string;
};
type SeedData = {
  sources: Record<string, { name: string; repo: string; url: string; license: string }>;
  commits: Record<string, string>;
  catalog: Record<CatalogName, SourceRow[]>;
};

const openLicenses = new Set(["CC-BY-SA-4.0", "CC0-1.0", "GPL-3.0", "MIT"]);
const splitList = (value: string) =>
  value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

function toDatabaseRow(row: SourceRow, catalog: CatalogName, sourceRegistry: SeedData["sources"]) {
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

async function readSeedData(): Promise<SeedData> {
  const input = await readFile(new URL("../data/catalog.json", import.meta.url), "utf8");
  return JSON.parse(input) as SeedData;
}

async function loadCatalogAttribution() {
  const [{ catalog, commits, sources }, attribution] = await Promise.all([
    readSeedData(),
    readFile(new URL("../ATTRIBUTION.md", import.meta.url), "utf8"),
  ]);
  const used = new Set(
    Object.values(catalog).flatMap((rows) => rows.flatMap((row) => splitList(row.sources))),
  );
  return {
    attribution,
    sources: Object.fromEntries(
      Object.entries(sources)
        .filter(([id]) => used.has(id))
        .map(([id, { name, repo, url, license }]) => [
          id,
          { name, url, license, commit: commits[repo] || null },
        ]),
    ),
  };
}

let attribution: Awaited<ReturnType<typeof loadCatalogAttribution>> | undefined;

export async function readCatalogAttribution() {
  attribution ??= await loadCatalogAttribution();
  return attribution;
}

export async function importCatalog(db: NodePgDatabase) {
  const { catalog, sources } = await readSeedData();

  return db.transaction(async (tx) => {
    let changed = 0;
    for (const name of Object.keys(tables) as CatalogName[]) {
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

export async function findCatalogMatches(db: NodePgDatabase, catalog: CatalogName, search: string) {
  const term = search.trim();
  if (!term) return [];

  const table = tables[catalog];
  return db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(catalogNameMatches(table, term))
    .orderBy(table.name, table.id);
}
