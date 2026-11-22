// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from "drizzle-orm";
import { equipment, fermentables, hops, miscs, styles, waterProfiles, yeasts } from "./schema.ts";

export const catalogTables = {
  hops,
  fermentables,
  yeasts,
  miscs,
  styles,
  water_profiles: waterProfiles,
  equipment,
};

export type CatalogName = keyof typeof catalogTables;

export function catalogNameMatches(table: (typeof catalogTables)[CatalogName], term: string) {
  return sql`
    strpos(lower(${table.name}), lower(${term})) > 0 OR EXISTS (
      SELECT FROM unnest(${table.aliases}) AS alias(name)
      WHERE strpos(lower(alias.name), lower(${term})) > 0
    )
  `;
}
