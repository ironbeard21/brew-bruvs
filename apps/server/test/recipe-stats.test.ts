// SPDX-License-Identifier: AGPL-3.0-or-later
// Recipe documents become the right brew-math inputs: line values first, then the catalog's.
import { recipeStats } from "@brew-bruvs/brew-math";
import { describe, expect, it } from "vitest";
import type { RecipeContent } from "../src/contracts/recipe-content.ts";
import { ApiError } from "../src/errors.ts";
import {
  type CatalogValues,
  computeStats,
  DEFAULT_EFFICIENCY_PCT,
  scaleContent,
} from "../src/services/recipe-stats.ts";

const empty = (): CatalogValues => ({
  fermentables: new Map(),
  hops: new Map(),
  yeasts: new Map(),
});

const doc = (over: Partial<RecipeContent> = {}): RecipeContent => ({
  schemaVersion: 1,
  fermentables: [],
  hops: [],
  yeasts: [{ name: "US-05", attenuationPct: 78 }],
  miscs: [],
  mash: [],
  fermentation: [],
  ...over,
});

const value = (r: ReturnType<typeof recipeStats>) => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

describe("computeStats", () => {
  it("uses each line's own values and falls back to the catalog", () => {
    const catalog = empty();
    catalog.fermentables.set("ferm-pale", { potentialSg: 1.037, colorEbc: 3.9 });
    catalog.hops.set("hop-magnum", { alphaAcidPct: 12 });
    catalog.yeasts.set("yeast-a", { attenuationMinPct: 73, attenuationMaxPct: 77 });
    const content = doc({
      efficiencyPct: 75,
      fermentables: [
        { name: "Pale", catalogId: "ferm-pale", kind: "grain", amountKg: 4.5 },
        { name: "Crystal", kind: "grain", amountKg: 0.3, potentialSg: 1.034, colorEbc: 79 },
        { name: "Sugar", kind: "sugar", amountKg: 0.2, potentialSg: 1.046, use: "boil" },
        // Packaging sugar never counts towards the original gravity.
        { name: "Priming", kind: "sugar", amountKg: 0.12, potentialSg: 1.046, use: "package" },
      ],
      hops: [
        { name: "Magnum", catalogId: "hop-magnum", amountKg: 0.02, use: "boil", timeMin: 60 },
        { name: "Citra", amountKg: 0.03, alphaAcidPct: 13, use: "boil", timeMin: 5 },
        { name: "Citra", amountKg: 0.05, alphaAcidPct: 13, use: "dry_hop", days: 4 },
      ],
      yeasts: [{ name: "Ale", catalogId: "yeast-a" }],
    });

    const result = computeStats(content, 20, { efficiencyPct: 60, boilSizeL: 26 }, catalog);
    expect(result).toEqual({
      statsError: null,
      stats: value(
        recipeStats({
          volumeL: 20,
          efficiencyPct: 75,
          fermentables: [
            { kg: 4.5, potentialSg: 1.037, mashed: true, colorEbc: 3.9 },
            { kg: 0.3, potentialSg: 1.034, mashed: true, colorEbc: 79 },
            { kg: 0.2, potentialSg: 1.046, mashed: false },
          ],
          attenuationPct: 75,
          hops: [
            { alphaAcidPct: 12, hopGrams: 20, minutes: 60 },
            { alphaAcidPct: 13, hopGrams: 30, minutes: 5 },
          ],
          boilVolumeL: 26,
        }),
      ),
    });
  });

  it("takes efficiency from the recipe, then the equipment, then the default", () => {
    const content = doc({
      fermentables: [{ name: "Pale", kind: "grain", amountKg: 4, potentialSg: 1.037 }],
    });
    const og = (eff: number) =>
      value(
        recipeStats({
          volumeL: 20,
          efficiencyPct: eff,
          fermentables: [{ kg: 4, potentialSg: 1.037, mashed: true }],
          attenuationPct: 78,
          hops: [],
        }),
      ).og;
    expect(
      computeStats(content, 20, { efficiencyPct: 65, boilSizeL: null }, empty()).stats?.og,
    ).toBe(og(65));
    expect(computeStats(content, 20, null, empty()).stats?.og).toBe(og(DEFAULT_EFFICIENCY_PCT));
  });

  it("treats juice by volume at its own gravity and honey as unmashed", () => {
    const content = doc({
      fermentables: [
        { name: "Apple juice", kind: "juice", amountL: 15, potentialSg: 1.05 },
        { name: "Honey", kind: "honey", amountKg: 1, potentialSg: 1.035 },
      ],
      yeasts: [{ name: "Cider", attenuationPct: 100 }],
    });
    expect(computeStats(content, 19, null, empty()).stats).toEqual(
      value(
        recipeStats({
          volumeL: 19,
          efficiencyPct: DEFAULT_EFFICIENCY_PCT,
          fermentables: [
            { liters: 15, sg: 1.05 },
            { kg: 1, potentialSg: 1.035, mashed: false },
          ],
          attenuationPct: 100,
          hops: [],
        }),
      ),
    );
  });

  it("explains what is missing instead of guessing", () => {
    const cases: [Partial<RecipeContent>, string][] = [
      [{ fermentables: [{ name: "Mystery malt", kind: "grain", amountKg: 1 }] }, "Mystery malt"],
      [{ fermentables: [{ name: "Juice", kind: "juice", amountL: 5 }] }, "Juice needs its gravity"],
      [{ hops: [{ name: "Old hop", amountKg: 0.01, use: "boil", timeMin: 60 }] }, "Old hop"],
      [{ yeasts: [{ name: "Unknown" }] }, "Add a yeast"],
      [{ yeasts: [] }, "Add a yeast"],
    ];
    for (const [over, message] of cases) {
      const result = computeStats(doc(over), 20, null, empty());
      expect(result.stats).toBeNull();
      expect(result.statsError).toContain(message);
    }
    // brew-math's own range checks come through as the message.
    const tooStrong = doc({
      fermentables: [{ name: "Pale", kind: "grain", amountKg: 100, potentialSg: 1.037 }],
    });
    expect(computeStats(tooStrong, 5, null, empty()).statsError).toMatch(/gravity/i);
  });
});

describe("scaleContent", () => {
  const content = doc({
    efficiencyPct: 72,
    fermentables: [
      { name: "Pale", kind: "grain", amountKg: 4, potentialSg: 1.037 },
      { name: "Honey", kind: "honey", amountKg: 1, potentialSg: 1.035 },
      { name: "Juice", kind: "juice", amountL: 2, potentialSg: 1.05 },
    ],
    hops: [{ name: "Citra", amountKg: 0.02, alphaAcidPct: 13, use: "boil", timeMin: 10 }],
    yeasts: [{ name: "US-05", packs: 1, attenuationPct: 78 }],
    miscs: [{ name: "Campden", kind: "sulfite", count: 2, use: "primary" }],
    mash: [{ name: "Sacch", type: "infusion", tempC: 66, timeMin: 60, infuseL: 12 }],
  });

  it("scales amounts by volume and mashed grain by efficiency too, keeping the gravity", () => {
    const scaled = scaleContent(
      content,
      { batchSizeL: 20, efficiencyPct: 72 },
      { batchSizeL: 40, efficiencyPct: 80 },
    );
    const mashed = (2 * 72) / 80;
    expect(scaled.efficiencyPct).toBe(80);
    expect(scaled.fermentables.map((f) => f.amountKg ?? f.amountL)).toEqual([4 * mashed, 2, 4]);
    expect(scaled.hops[0]?.amountKg).toBe(0.04);
    expect(scaled.yeasts[0]?.packs).toBe(2);
    expect(scaled.miscs[0]?.count).toBe(4);
    expect(scaled.mash[0]?.infuseL).toBeCloseTo(12 * mashed, 12);
    // Same OG and IBU at twice the size.
    const before = computeStats(content, 20, null, empty()).stats;
    const after = computeStats(scaled, 40, null, empty()).stats;
    expect(after?.og).toBeCloseTo(before?.og ?? 0, 12);
    expect(after?.ibu).toBeCloseTo(before?.ibu ?? 0, 9);
  });

  it("refuses sizes brew-math can't scale", () => {
    expect(() =>
      scaleContent(
        content,
        { batchSizeL: 20, efficiencyPct: 72 },
        { batchSizeL: 0, efficiencyPct: 80 },
      ),
    ).toThrow(ApiError);
  });
});
