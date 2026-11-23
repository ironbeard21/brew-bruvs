// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exportRecipeVersion,
  type ImportedRecipeDraft,
  type RecipeDetail,
} from "../src/api/recipes";
import { BrewSheetView } from "../src/components/recipes/BrewSheetView";
import { detectRecipeFormat } from "../src/components/recipes/fileIO";
import { RecipeImportFlow } from "../src/components/recipes/RecipeImportFlow";
import type { KeyValueStorage } from "../src/state/storage";
import { UnitsProvider } from "../src/state/units";

afterEach(cleanup);

const noopStorage: KeyValueStorage = {
  async getItem() {
    return null;
  },
  async setItem() {},
  async removeItem() {},
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SAMPLE_DRAFT: ImportedRecipeDraft = {
  name: "Harbor Pale Ale",
  beverage: "beer",
  batchSizeL: 18.927,
  styleId: null,
  visibility: "private",
  credit: {
    sourceUrl: null,
    author: "Robin Brewer",
    publicSharingBlocked: false,
  },
  content: {
    schemaVersion: 1,
    efficiencyPct: 72,
    boilTimeMin: 60,
    fermentables: [
      {
        name: "Pale Malt (2 Row) US",
        kind: "grain",
        amountKg: 4.5359237,
        use: "mash",
        potentialSg: 1.0365,
        colorEbc: 3.8,
      },
    ],
    hops: [
      {
        name: "Columbus",
        amountKg: 0.0283495,
        alphaAcidPct: 16,
        use: "boil",
        timeMin: 60,
      },
    ],
    yeasts: [{ name: "Safale US-05", form: "dry", packs: 1, attenuationPct: 81 }],
    miscs: [],
    mash: [{ name: "Saccharification", type: "infusion", tempC: 66.7, timeMin: 60 }],
    fermentation: [{ name: "Primary", stage: "primary", tempC: 19, days: 14 }],
    notes: "Crisp west coast pale.",
  },
};

describe("detectRecipeFormat", () => {
  it("infers beerxml and beerjson from file extensions and raw text", () => {
    expect(detectRecipeFormat("pale-ale.xml", "")).toBe("beerxml");
    expect(detectRecipeFormat("cider.beerjson", "")).toBe("beerjson");
    expect(detectRecipeFormat(null, "  <?xml version='1.0'?><RECIPES/>")).toBe("beerxml");
    expect(detectRecipeFormat(null, '{"beerjson":{"version":1}}')).toBe("beerjson");
    expect(detectRecipeFormat("notes.txt", "plain text")).toBeNull();
  });
});

describe("RecipeImportFlow", () => {
  it("parses BeerXML into review screen, shows permanent credit, lets user fix amounts, and preserves credit on save", async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/recipes/import")) {
        return jsonResponse(SAMPLE_DRAFT, 200);
      }
      if (url.includes("/api/equipment-profiles")) {
        return jsonResponse([], 200);
      }
      return jsonResponse({ items: [], nextOffset: null }, 200);
    }) as unknown as typeof fetch;

    const onSaveImported = vi.fn().mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <UnitsProvider initialUnitSystem="us" storage={noopStorage}>
          <RecipeImportFlow
            serverUrl="http://brew.test"
            authToken="tok-1"
            onSaveImported={onSaveImported}
            customFetch={mockFetch}
          />
        </UnitsProvider>
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByTestId("import-file-contents-input"), {
      target: {
        value: "<?xml version='1.0'?><RECIPES><RECIPE><NAME>Harbor</NAME></RECIPE></RECIPES>",
      },
    });
    fireEvent.click(screen.getByTestId("import-file-submit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-review-screen")).toBeTruthy();
    });

    // Credit preview is displayed and non-editable
    expect(screen.getByTestId("import-credit-preview").textContent).toContain("Robin Brewer");

    // Brewer fixes the recipe name and grain amount before saving
    fireEvent.change(screen.getByTestId("recipe-name-input"), {
      target: { value: "Harbor Pale Ale (Fixed)" },
    });
    fireEvent.change(screen.getByTestId("ferm-0-amount"), {
      target: { value: "11.0" },
    });

    fireEvent.click(screen.getByTestId("recipe-save-button"));

    await waitFor(() => {
      expect(onSaveImported).toHaveBeenCalledTimes(1);
    });
    const saved = onSaveImported.mock.calls[0]?.[0];
    expect(saved.name).toBe("Harbor Pale Ale (Fixed)");
    expect(saved.visibility).toBe("private");
    expect(saved.credit).toEqual(SAMPLE_DRAFT.credit);
    // 11 lb -> ~4.99 kg in SI
    expect(saved.content.fermentables[0]?.amountKg).toBeCloseTo(4.9895, 2);
  });

  it("imports from a URL, displays excerpt and URL credit, and preserves publicSharingBlocked", async () => {
    const urlDraft: ImportedRecipeDraft = {
      ...SAMPLE_DRAFT,
      credit: {
        sourceUrl: "https://recipes.example.org/harbor-pale",
        site: "recipes.example.org",
        author: "Alex Hops",
        license: "CC-BY-4.0",
        publicSharingBlocked: true,
      },
    };
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/recipes/import-url")) {
        return jsonResponse({ draft: urlDraft, excerpt: "A crisp harbor pale ale." }, 200);
      }
      if (url.includes("/api/equipment-profiles")) {
        return jsonResponse([], 200);
      }
      return jsonResponse({ items: [], nextOffset: null }, 200);
    }) as unknown as typeof fetch;

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <UnitsProvider initialUnitSystem="us" storage={noopStorage}>
          <RecipeImportFlow
            serverUrl="http://brew.test"
            authToken="tok-1"
            onSaveImported={vi.fn().mockResolvedValue(undefined)}
            customFetch={mockFetch}
          />
        </UnitsProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Import from recipe URL" }));
    fireEvent.change(screen.getByTestId("import-url-input"), {
      target: { value: "https://recipes.example.org/harbor-pale" },
    });
    fireEvent.click(screen.getByTestId("import-url-submit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-review-screen")).toBeTruthy();
    });

    const creditText = screen.getByTestId("import-credit-preview").textContent ?? "";
    expect(creditText).toContain("Alex Hops");
    expect(creditText).toContain("recipes.example.org");
    expect(creditText).toContain("CC-BY-4.0");
    expect(creditText).toContain("block public sharing");
    expect(screen.getByTestId("import-excerpt-preview").textContent).toContain(
      "A crisp harbor pale ale.",
    );
  });
});

describe("exportRecipeVersion", () => {
  it("downloads BeerXML and BeerJSON with filenames from Content-Disposition", async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("format=beerxml")) {
        return new Response("<?xml version='1.0'?><RECIPES/>", {
          status: 200,
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "content-disposition": 'attachment; filename="recipe-1-v2.xml"',
          },
        });
      }
      return new Response('{"beerjson":{"version":1,"recipes":[]}}', {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": 'attachment; filename="recipe-1-v2.json"',
        },
      });
    }) as unknown as typeof fetch;

    const xml = await exportRecipeVersion(
      "http://brew.test",
      "tok",
      { recipeId: "11111111-1111-1111-1111-111111111111", version: 2, format: "beerxml" },
      mockFetch,
    );
    expect(xml.filename).toBe("recipe-1-v2.xml");
    expect(xml.contents).toContain("<RECIPES/>");

    const json = await exportRecipeVersion(
      "http://brew.test",
      "tok",
      { recipeId: "11111111-1111-1111-1111-111111111111", version: 2, format: "beerjson" },
      mockFetch,
    );
    expect(json.filename).toBe("recipe-1-v2.json");
    expect(json.contents).toContain('"beerjson"');
  });
});

describe("BrewSheetView", () => {
  it("renders recipe details, ingredients, mash schedule, stats, credit, and triggers print/export", () => {
    const recipe: RecipeDetail = {
      id: "r-1",
      uri: "http://brew.test/recipes/r-1",
      name: "Harbor Pale Ale",
      beverage: "beer",
      visibility: "private",
      owner: { type: "user", id: "u-1" },
      credit: {
        sourceUrl: null,
        site: null,
        author: "Robin Brewer",
        importedAt: "2026-11-22T12:00:00Z",
        license: null,
      },
      forkedFrom: null,
      publicSharingBlocked: false,
      latestVersion: 1,
      createdAt: "2026-11-22T12:00:00Z",
      updatedAt: "2026-11-22T12:00:00Z",
      version: {
        id: "v-1",
        version: 1,
        name: "Harbor Pale Ale",
        beverage: "beer",
        styleId: null,
        batchSizeL: 18.927,
        equipmentProfileId: null,
        content: SAMPLE_DRAFT.content,
        createdAt: "2026-11-22T12:00:00Z",
        stats: null,
        statsError: null,
        styleFit: null,
      },
    };

    const onExport = vi.fn().mockResolvedValue(undefined);
    const onBack = vi.fn();
    const originalPrint = window.print;
    const printSpy = vi.fn();
    window.print = printSpy;

    try {
      render(
        <UnitsProvider initialUnitSystem="us" storage={noopStorage}>
          <BrewSheetView
            recipe={recipe}
            version={recipe.version}
            onBack={onBack}
            onExport={onExport}
          />
        </UnitsProvider>,
      );

      expect(screen.getByTestId("brew-sheet-title").textContent).toBe("Harbor Pale Ale");
      expect(screen.getByTestId("brew-sheet-credit").textContent).toContain("Robin Brewer");
      expect(screen.getByTestId("brew-sheet-stats")).toBeTruthy();
      expect(screen.getByText("Pale Malt (2 Row) US")).toBeTruthy();
      expect(screen.getByText("Columbus")).toBeTruthy();
      expect(screen.getByText("Safale US-05")).toBeTruthy();

      fireEvent.click(screen.getByTestId("print-brew-sheet-button"));
      expect(printSpy).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("brew-sheet-export-beerxml"));
      expect(onExport).toHaveBeenCalledWith("beerxml");
    } finally {
      window.print = originalPrint;
    }
  });
});
