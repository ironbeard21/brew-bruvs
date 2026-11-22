// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogStyle } from "../src/api/catalog";
import type { Recipe, RecipeDetail } from "../src/api/recipes";
import {
  computeLiveRecipeStats,
  createBlankDraft,
  draftToVersionInput,
  newLineKey,
} from "../src/components/recipes/liveStats";
import { RecipeBuilder } from "../src/components/recipes/RecipeBuilder";
import { RecipeCreditCard } from "../src/components/recipes/RecipeCreditCard";
import { RecipeSharingCard } from "../src/components/recipes/RecipeSharingCard";
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

const APA_STYLE: CatalogStyle = {
  id: "style-bjcp-2015-18b",
  catalog: "styles",
  name: "American Pale Ale",
  styleGuide: "BJCP 2015",
  styleId: "18B",
  category: "Pale American Ale",
  beverage: "beer",
  ogMin: 1.045,
  ogMax: 1.06,
  fgMin: 1.01,
  fgMax: 1.015,
  ibuMin: 30,
  ibuMax: 50,
  colorEbcMin: 9.85,
  colorEbcMax: 19.7,
  abvMinPct: 4.5,
  abvMaxPct: 6.2,
  carbVolsMin: 1.5,
  carbVolsMax: 3.0,
  aliases: [],
  sources: ["bjcpjson"],
  licenses: ["MIT"],
  notes: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("liveStats and SI conversion", () => {
  it("computes live stats inside BJCP American Pale Ale ranges and converts US inputs to SI", () => {
    const draft = createBlankDraft("us", "beer");
    draft.name = "Backyard Pale Ale";
    draft.styleId = APA_STYLE.id;
    draft.batchSizeText = "5.0";
    draft.efficiencyText = "72";
    draft.fermentables = [
      {
        key: newLineKey("ferm"),
        name: "Pale Malt (2 Row) US",
        catalogId: "ferm-pale-malt-2-row-us",
        kind: "grain",
        measure: "weight",
        amountText: "9.8",
        use: "mash",
        potentialSgText: "1.0365",
        colorText: "2.0",
        dayOffsetText: "",
      },
      {
        key: newLineKey("ferm"),
        name: "Caramel/Crystal Malt – 60L",
        catalogId: "ferm-caramel-crystal-malt-60l",
        kind: "grain",
        measure: "weight",
        amountText: "0.75",
        use: "mash",
        potentialSgText: "1.0342",
        colorText: "60.1",
        dayOffsetText: "",
      },
    ];
    draft.hops = [
      {
        key: newLineKey("hop"),
        name: "Columbus",
        catalogId: "hop-columbus",
        amountText: "0.6",
        alphaAcidText: "16.0",
        use: "boil",
        timeMinText: "60",
        daysText: "",
      },
    ];
    draft.yeasts = [
      {
        key: newLineKey("yeast"),
        name: "Safale American Ale",
        catalogId: "yeast-fermentis-us-05",
        form: "dry",
        packsText: "1",
        attenuationText: "81",
      },
    ];

    const live = computeLiveRecipeStats(draft, "us", APA_STYLE, null);
    expect(live.error).toBeNull();
    expect(live.stats).not.toBeNull();
    expect(live.fit).toEqual({
      og: "inside",
      fg: "inside",
      abvPct: "inside",
      ibu: "inside",
      colorEbc: "inside",
    });

    const built = draftToVersionInput(draft, "us");
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.input.batchSizeL).toBeCloseTo(18.927, 2);
      expect(built.input.content.fermentables[0]?.amountKg).toBeCloseTo(4.445, 2);
      expect(built.input.content.hops[0]?.amountKg).toBeCloseTo(0.017, 3);
    }
  });

  it("handles mead honey and cider juice fermentables", () => {
    const draft = createBlankDraft("us", "mead");
    draft.name = "Cyser";
    draft.batchSizeText = "5.0";
    draft.fermentables = [
      {
        key: newLineKey("ferm"),
        name: "Apple Juice",
        kind: "juice",
        measure: "volume",
        amountText: "4.0",
        use: "fermentation",
        potentialSgText: "1.050",
        colorText: "",
        dayOffsetText: "",
      },
      {
        key: newLineKey("ferm"),
        name: "Wildflower Honey",
        kind: "honey",
        measure: "weight",
        amountText: "6.0",
        use: "fermentation",
        potentialSgText: "1.035",
        colorText: "",
        dayOffsetText: "",
      },
    ];
    draft.yeasts = [
      {
        key: newLineKey("yeast"),
        name: "71B",
        form: "dry",
        packsText: "1",
        attenuationText: "100",
      },
    ];

    const live = computeLiveRecipeStats(draft, "us", null, null);
    expect(live.error).toBeNull();
    expect(live.stats?.og).toBeCloseTo(1.082, 3);
    expect(live.stats?.abvPct).toBeGreaterThan(10);
  });
});

describe("RecipeBuilder interactive catalog & live stats", () => {
  it("searches catalog with aliases (Zeus -> Columbus), adds custom lines, and updates stats live", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/equipment-profiles")) {
        return jsonResponse([]);
      }
      if (url.includes("/api/catalog/styles")) {
        return jsonResponse({ items: [APA_STYLE], nextOffset: null });
      }
      if (url.includes("/api/catalog/hops") && url.toLowerCase().includes("zeus")) {
        return jsonResponse({
          items: [
            {
              id: "hop-columbus",
              catalog: "hops",
              name: "Columbus",
              aliases: ["Zeus", "Tomahawk"],
              sources: ["bt003"],
              licenses: ["GPL-3.0"],
              notes: null,
              origin: "US",
              hopType: "bittering",
              alphaAcidPct: 16.0,
              alphaAcidMinPct: 14.0,
              alphaAcidMaxPct: 17.0,
              betaAcidPct: null,
              cohumulonePct: null,
              totalOilMlPer100g: null,
              myrcenePct: null,
              humulenePct: null,
              caryophyllenePct: null,
              farnesenePct: null,
              hsi: null,
              substitutes: null,
              beverages: ["beer"],
            },
          ],
          nextOffset: null,
        });
      }
      return jsonResponse({ items: [], nextOffset: null });
    };

    const onSaveNew = vi.fn(async () => {});
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <UnitsProvider initialUnitSystem="us" storage={noopStorage}>
          <RecipeBuilder
            serverUrl="http://localhost:8080"
            authToken={null}
            onSaveNew={onSaveNew}
            customFetch={mockFetch}
          />
        </UnitsProvider>
      </QueryClientProvider>,
    );

    // Search style and pick American Pale Ale
    fireEvent.change(screen.getByTestId("style-search-input"), {
      target: { value: "American Pale" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("style-option-style-bjcp-2015-18b")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("style-option-style-bjcp-2015-18b"));
    expect(screen.getByTestId("stats-style-name").textContent).toContain("American Pale Ale");

    // Search hops by alias "Zeus" and find Columbus
    fireEvent.change(screen.getByTestId("hop-search-input"), { target: { value: "Zeus" } });
    await waitFor(() => expect(screen.getByTestId("hop-option-hop-columbus")).toBeTruthy());
    fireEvent.click(screen.getByTestId("hop-option-hop-columbus"));
    expect((screen.getByTestId("hop-0-name") as HTMLInputElement).value).toBe("Columbus");

    // Add free-text custom fermentable and yeast
    fireEvent.change(screen.getByTestId("fermentable-search-input"), {
      target: { value: "Home Malted Barley" },
    });
    fireEvent.click(screen.getByTestId("fermentable-add-custom"));
    fireEvent.change(screen.getByTestId("ferm-0-amount"), { target: { value: "10" } });

    fireEvent.click(screen.getByTestId("yeast-add-custom"));

    await waitFor(() => expect(screen.getByTestId("stat-og").textContent).toContain("1.0"));
    expect(screen.getByTestId("stat-ibu").textContent).toContain("IBU");

    // Save calls onSaveNew with SI values
    fireEvent.change(screen.getByTestId("recipe-name-input"), {
      target: { value: "Alias Hop Pale Ale" },
    });
    fireEvent.click(screen.getByTestId("recipe-save-button"));

    await waitFor(() => expect(onSaveNew).toHaveBeenCalledTimes(1));
  });
});

describe("RecipeCreditCard and RecipeSharingCard", () => {
  const importedRecipe: Recipe = {
    id: "01950000-0000-7000-8000-000000000100",
    uri: "http://localhost:8080/recipes/100",
    name: "Imported Cider",
    beverage: "cider",
    visibility: "private",
    owner: { type: "user", id: "01950000-0000-7000-8000-000000000001" },
    credit: {
      sourceUrl: "https://example.org/cider",
      site: "Example Brewing",
      author: "Jane Brewer",
      importedAt: "2026-11-22T00:00:00.000Z",
      license: "CC-BY-4.0",
    },
    forkedFrom: {
      uri: "http://localhost:8080/recipes/99",
      recipeId: "01950000-0000-7000-8000-000000000099",
    },
    publicSharingBlocked: true,
    latestVersion: 1,
    createdAt: "2026-11-22T00:00:00.000Z",
    updatedAt: "2026-11-22T00:00:00.000Z",
  };

  it("renders credit and forked-from strictly read-only with no editable inputs", () => {
    render(<RecipeCreditCard recipe={importedRecipe} />);

    const creditBox = screen.getByTestId("recipe-credit-box");
    expect(creditBox.textContent).toContain("Jane Brewer");
    expect(creditBox.textContent).toContain("Example Brewing");
    expect(creditBox.querySelectorAll("input, textarea").length).toBe(0);

    const forkedBox = screen.getByTestId("recipe-forked-from-box");
    expect(forkedBox.textContent).toContain("http://localhost:8080/recipes/99");
    expect(forkedBox.querySelectorAll("input, textarea").length).toBe(0);
  });

  it("enforces publicSharingBlocked and confirmPublic for imported recipes", async () => {
    const mockFetch: typeof fetch = async () => jsonResponse([]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <RecipeSharingCard
          serverUrl="http://localhost:8080"
          authToken={null}
          recipe={importedRecipe as RecipeDetail}
          canManage
          customFetch={mockFetch}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("public-sharing-blocked-banner")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Unlisted link visibility"));
    expect(screen.getByTestId("confirm-public-checkbox")).toBeTruthy();

    fireEvent.click(screen.getByTestId("save-visibility-button"));
    expect(screen.getByTestId("visibility-error").textContent).toContain("Confirm");
  });
});
