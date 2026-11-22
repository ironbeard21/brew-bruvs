// SPDX-License-Identifier: AGPL-3.0-or-later
// Turns a recipe document into brew-math inputs. The formulas themselves stay in brew-math;
// this file only picks values: the line's own, else the catalog's.
import {
  type Fermentable,
  type HopAddition,
  type RecipeStats,
  recipeStats,
  scaleFactors,
} from "@brew-bruvs/brew-math";
import { schema } from "@brew-bruvs/db";
import { inArray } from "drizzle-orm";
import type { RecipeContent } from "../contracts/recipe-content.ts";
import { ApiError } from "../errors.ts";
import type { Tx } from "./recipes.ts";

/** Used when neither the recipe nor its equipment profile gives a brewhouse efficiency. */
export const DEFAULT_EFFICIENCY_PCT = 72;

type FermentableLine = RecipeContent["fermentables"][number];

export interface CatalogValues {
  fermentables: Map<string, { potentialSg: number | null; colorEbc: number | null }>;
  hops: Map<string, { alphaAcidPct: number | null }>;
  yeasts: Map<string, { attenuationMinPct: number | null; attenuationMaxPct: number | null }>;
}

export interface Equipment {
  efficiencyPct: number | null;
  boilSizeL: number | null;
}

export type Computed =
  | { stats: RecipeStats; statsError: null }
  | { stats: null; statsError: string };

/** Mashed and steeped grain, where brewhouse efficiency applies. */
export function isMashed(line: FermentableLine): boolean {
  if (line.amountKg === undefined) return false;
  if (line.use) return line.use === "mash" || line.use === "steep";
  return line.kind === "grain" || line.kind === "adjunct";
}

export function efficiencyOf(content: RecipeContent, equipment: Equipment | null): number {
  return content.efficiencyPct ?? equipment?.efficiencyPct ?? DEFAULT_EFFICIENCY_PCT;
}

const failed = (statsError: string): Computed => ({ stats: null, statsError });

export function computeStats(
  content: RecipeContent,
  batchSizeL: number,
  equipment: Equipment | null,
  catalog: CatalogValues,
): Computed {
  const fermentables: Fermentable[] = [];
  // Priming sugar goes in at packaging and doesn't count towards the original gravity.
  for (const f of content.fermentables.filter((f) => f.use !== "package")) {
    const known = f.catalogId ? catalog.fermentables.get(f.catalogId) : undefined;
    if (f.amountL !== undefined) {
      if (f.potentialSg === undefined) return failed(`${f.name} needs its gravity (potentialSg)`);
      fermentables.push({ liters: f.amountL, sg: f.potentialSg });
      continue;
    }
    const potentialSg = f.potentialSg ?? known?.potentialSg;
    if (potentialSg == null) return failed(`${f.name} needs a potential (potentialSg)`);
    const colorEbc = f.colorEbc ?? known?.colorEbc;
    fermentables.push({
      kg: f.amountKg as number,
      potentialSg,
      mashed: isMashed(f),
      ...(colorEbc == null ? {} : { colorEbc }),
    });
  }

  const hops: HopAddition[] = [];
  for (const h of content.hops.filter((h) => h.use === "boil")) {
    const known = h.catalogId ? catalog.hops.get(h.catalogId) : undefined;
    const alphaAcidPct = h.alphaAcidPct ?? known?.alphaAcidPct;
    if (alphaAcidPct == null) return failed(`${h.name} needs an alpha acid (alphaAcidPct)`);
    hops.push({ alphaAcidPct, hopGrams: h.amountKg * 1000, minutes: h.timeMin as number });
  }

  const attenuationPct = content.yeasts
    .map((y) => {
      if (y.attenuationPct !== undefined) return y.attenuationPct;
      const known = y.catalogId ? catalog.yeasts.get(y.catalogId) : undefined;
      const range = [known?.attenuationMinPct, known?.attenuationMaxPct].filter((v) => v != null);
      return range.length ? range.reduce((a, b) => a + b) / range.length : undefined;
    })
    .find((v) => v !== undefined);
  if (attenuationPct === undefined)
    return failed("Add a yeast with an attenuation (attenuationPct)");

  const result = recipeStats({
    volumeL: batchSizeL,
    efficiencyPct: efficiencyOf(content, equipment),
    fermentables,
    attenuationPct,
    hops,
    ...(equipment?.boilSizeL != null && equipment.boilSizeL >= batchSizeL
      ? { boilVolumeL: equipment.boilSizeL }
      : {}),
  });
  return result.ok ? { stats: result.value, statsError: null } : failed(result.error.message);
}

/** Loads the catalog values the document's lines point at. */
export async function catalogValues(tx: Tx, content: RecipeContent): Promise<CatalogValues> {
  const ids = (lines: { catalogId?: string | undefined }[]) =>
    lines.flatMap((l) => (l.catalogId ? [l.catalogId] : []));
  const load = async <T extends { id: string }>(rows: Promise<T[]>) =>
    new Map((await rows).map((r) => [r.id, r]));
  const { fermentables, hops, yeasts } = schema;
  const fIds = ids(content.fermentables);
  const hIds = ids(content.hops);
  const yIds = ids(content.yeasts);
  return {
    fermentables: await load(
      fIds.length
        ? tx
            .select({
              id: fermentables.id,
              potentialSg: fermentables.potentialSg,
              colorEbc: fermentables.colorEbc,
            })
            .from(fermentables)
            .where(inArray(fermentables.id, fIds))
        : Promise.resolve([]),
    ),
    hops: await load(
      hIds.length
        ? tx
            .select({ id: hops.id, alphaAcidPct: hops.alphaAcidPct })
            .from(hops)
            .where(inArray(hops.id, hIds))
        : Promise.resolve([]),
    ),
    yeasts: await load(
      yIds.length
        ? tx
            .select({
              id: yeasts.id,
              attenuationMinPct: yeasts.attenuationMinPct,
              attenuationMaxPct: yeasts.attenuationMaxPct,
            })
            .from(yeasts)
            .where(inArray(yeasts.id, yIds))
        : Promise.resolve([]),
    ),
  };
}

/**
 * Scales every amount to a new batch size and efficiency with brew-math's scaleFactors.
 * Mashed grain and mash water follow the efficiency too, so the gravity stays the same.
 */
export function scaleContent(
  content: RecipeContent,
  from: { batchSizeL: number; efficiencyPct: number },
  to: { batchSizeL: number; efficiencyPct: number },
): RecipeContent {
  const factors = scaleFactors({
    fromVolumeL: from.batchSizeL,
    toVolumeL: to.batchSizeL,
    fromEfficiencyPct: from.efficiencyPct,
    toEfficiencyPct: to.efficiencyPct,
  });
  if (!factors.ok) throw new ApiError(400, "cannot_scale", factors.error.message);
  const { amounts, mashed } = factors.value;
  const times = <T extends object, K extends keyof T>(line: T, keys: K[], by: number): T => {
    const out = { ...line };
    for (const k of keys)
      if (typeof out[k] === "number") out[k] = ((out[k] as number) * by) as T[K];
    return out;
  };
  return {
    ...content,
    efficiencyPct: to.efficiencyPct,
    fermentables: content.fermentables.map((f) =>
      times(f, ["amountKg", "amountL"], isMashed(f) ? mashed : amounts),
    ),
    hops: content.hops.map((h) => times(h, ["amountKg"], amounts)),
    yeasts: content.yeasts.map((y) => times(y, ["packs", "amountKg", "amountL"], amounts)),
    miscs: content.miscs.map((m) => times(m, ["amountKg", "amountL", "count"], amounts)),
    mash: content.mash.map((s) => times(s, ["infuseL"], mashed)),
  };
}
