// SPDX-License-Identifier: AGPL-3.0-or-later
import { readCatalogAttribution } from "@brew-bruvs/catalog-seed";
import { type CatalogName, catalogNameMatches, catalogTables, type Db } from "@brew-bruvs/db";
import { eq } from "drizzle-orm";
import { CatalogItem } from "../contracts/catalog.ts";
import { ApiError } from "../errors.ts";

export function createCatalogService(db: Db) {
  return {
    async list(
      catalog: CatalogName,
      page: { q?: string | undefined; limit: number; offset: number },
    ) {
      const table = catalogTables[catalog];
      const { q, limit, offset } = page;
      const rows = await db
        .select()
        .from(table)
        .where(q ? catalogNameMatches(table, q) : undefined)
        .orderBy(table.name, table.id)
        .limit(limit + 1)
        .offset(offset);
      return {
        items: rows.slice(0, limit).map((row) => CatalogItem.parse({ ...row, catalog })),
        nextOffset: rows.length > limit ? offset + limit : null,
      };
    },
    async get(catalog: CatalogName, id: string) {
      const table = catalogTables[catalog];
      const [row] = await db.select().from(table).where(eq(table.id, id));
      if (!row) throw new ApiError(404, "not_found", "Catalog item not found");
      return CatalogItem.parse({ ...row, catalog });
    },
    attribution: readCatalogAttribution,
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
