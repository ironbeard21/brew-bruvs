// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BatchDetail } from "../src/api/batches";
import type { Brewery } from "../src/api/breweries";
import type {
  BatchStats,
  CreateInventoryItemInput,
  InventoryChange,
  InventoryItem,
  Reservation,
  ShoppingList,
} from "../src/api/inventory";
import {
  BatchInventoryChangeBanner,
  BatchInventorySection,
} from "../src/components/batches/BatchInventorySection";
import { InventoryEditorCard } from "../src/components/inventory/InventoryEditorCard";
import { InventoryPanel } from "../src/components/inventory/InventoryPanel";
import {
  buildBatchInventoryHref,
  canAccessOwnerInventory,
  resolveInventoryBrewery,
} from "../src/components/inventory/inventoryScope";
import {
  convertDisplayUnitForSystem,
  displayUnitToSi,
  formatInventoryAmount,
  formatShoppingListText,
  isLowStock,
  siToDisplayValue,
} from "../src/components/inventory/inventoryUnits";
import { ShoppingListPanel } from "../src/components/inventory/ShoppingListPanel";
import { notifyLowStockItems } from "../src/notifications";
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

function renderWithProviders(ui: React.ReactElement, initialUnitSystem: "us" | "metric" = "us") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <UnitsProvider storage={noopStorage} initialUnitSystem={initialUnitSystem}>
        {ui}
      </UnitsProvider>
    </QueryClientProvider>,
  );
}

const SERVER_URL = "https://brew.example.test";
const USER_ID = "00000000-0000-7000-8000-000000000001";
const BREWERY_ID = "11111111-1111-7111-8111-111111111111";

const BREWERY_OWNER: Brewery = {
  id: BREWERY_ID,
  uri: `${SERVER_URL}/breweries/${BREWERY_ID}`,
  name: "Northside Brew Club",
  description: null,
  city: "Portland",
  state: "OR",
  role: "owner",
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
};

const MALT_ITEM: InventoryItem = {
  id: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
  uri: `${SERVER_URL}/inventory/aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa`,
  owner: { type: "brewery", id: BREWERY_ID },
  name: "Pale Malt (2 Row) US",
  catalogId: "ferm-pale-malt-2-row-us",
  quantity: 10,
  quantityUnit: "kg",
  reserved: 4.5,
  available: 5.5,
  lot: "LOT-2026-MALT",
  location: "Grain Room",
  alphaAcidPct: null,
  purchasedOn: "2026-11-01",
  bestBefore: "2027-06-01",
  lowStockThreshold: 2,
  notes: "55 lb sack",
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
};

const HOP_LOW_ITEM: InventoryItem = {
  id: "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb",
  uri: `${SERVER_URL}/inventory/bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb`,
  owner: { type: "brewery", id: BREWERY_ID },
  name: "Columbus",
  catalogId: "hop-columbus",
  quantity: 0.056699,
  quantityUnit: "kg",
  reserved: 0.0283495,
  available: 0.0283495,
  lot: "LOT-HOP-99",
  location: "Freezer",
  alphaAcidPct: 16.5,
  purchasedOn: "2026-11-05",
  bestBefore: "2027-11-05",
  lowStockThreshold: 0.113398,
  notes: "Pellet hops",
  createdAt: "2026-11-05T10:00:00Z",
  updatedAt: "2026-11-05T10:00:00Z",
};

describe("inventoryUnits and local low-stock alerts", () => {
  it("converts US and metric inputs to SI via brew-math and formats display amounts", () => {
    const lbSi = displayUnitToSi(10, "lb");
    expect(lbSi.unit).toBe("kg");
    expect(lbSi.amount).toBeCloseTo(4.5359237, 6);
    expect(siToDisplayValue(lbSi.amount, "lb")).toBeCloseTo(10, 5);

    const ozSi = displayUnitToSi(2, "oz");
    expect(ozSi.unit).toBe("kg");
    expect(ozSi.amount).toBeCloseTo(0.056699, 5);
    expect(formatInventoryAmount(ozSi.amount, "kg", "us")).toBe("2.00 oz");
    expect(formatInventoryAmount(ozSi.amount, "kg", "metric")).toBe("57 g");

    expect(formatInventoryAmount(1, "kg", "us")).toBe("2.20 lb");
    expect(formatInventoryAmount(1, "kg", "metric")).toBe("1.00 kg");
    expect(formatInventoryAmount(3.785411784, "l", "us")).toBe("1.00 gal");
    expect(formatInventoryAmount(0.25, "l", "metric")).toBe("250 mL");
    expect(formatInventoryAmount(3, "each", "us")).toBe("3 each");

    expect(convertDisplayUnitForSystem("lb", "metric")).toBe("kg");
    expect(convertDisplayUnitForSystem("oz", "metric")).toBe("g");
    expect(convertDisplayUnitForSystem("kg", "us")).toBe("lb");
    expect(convertDisplayUnitForSystem("ml", "us")).toBe("floz");
    expect(convertDisplayUnitForSystem("each", "metric")).toBe("each");

    expect(isLowStock(MALT_ITEM)).toBe(false);
    expect(isLowStock(HOP_LOW_ITEM)).toBe(true);
    expect(isLowStock({ available: 2, lowStockThreshold: 2 })).toBe(false);
    expect(isLowStock({ available: 0, lowStockThreshold: null })).toBe(false);
  });

  it("formats a plain-text shopping checklist in user units", () => {
    const shopping: ShoppingList = {
      short: [
        {
          name: "Safale US-05",
          catalogId: "yeast-fermentis-us-05",
          unit: "each",
          short: 2,
          batches: [{ id: "b-1", name: "Club Pale Ale" }],
        },
      ],
      lowStock: [HOP_LOW_ITEM],
    };
    const text = formatShoppingListText(shopping, "us", "Northside Brew Club");
    expect(text).toContain("Brew-Bruvs Shopping List (Northside Brew Club)");
    expect(text).toContain("Safale US-05: need 2 each (Club Pale Ale)");
    expect(text).toContain("Columbus: 1.00 oz available (threshold 4.00 oz)");
  });

  it("keeps alerts pending until delivery succeeds, deduplicates once delivered, and uses stable keys", async () => {
    const map = new Map<string, string>();
    const storage: KeyValueStorage = {
      async getItem(k) {
        return map.get(k) ?? null;
      },
      async setItem(k, v) {
        map.set(k, v);
      },
      async removeItem(k) {
        map.delete(k);
      },
    };

    const deliveredLog: { title: string; body?: string }[] = [];
    const OriginalNotification = globalThis.Notification;
    let mockPermission: NotificationPermission = "default";

    class MockNotification {
      static get permission() {
        return mockPermission;
      }
      static async requestPermission() {
        return mockPermission;
      }
      constructor(title: string, opts?: NotificationOptions) {
        deliveredLog.push({ title, ...(opts?.body ? { body: opts.body } : {}) });
      }
    }

    Object.defineProperty(globalThis, "Notification", {
      value: MockNotification,
      configurable: true,
      writable: true,
    });

    try {
      // 1. Permission not granted yet -> stays pending (NOT marked delivered in storage)
      const beforeGrant = await notifyLowStockItems([HOP_LOW_ITEM], "us", {
        scopeKey: "test::me",
        storage,
      });
      expect(beforeGrant.newlyAlerted).toHaveLength(1);
      expect(beforeGrant.delivered).toBe(false);
      expect(deliveredLog).toHaveLength(0);
      expect(map.size).toBe(0);

      // 2. Permission granted -> same low item now delivers and records under stable key
      mockPermission = "granted";
      const afterGrant = await notifyLowStockItems([HOP_LOW_ITEM], "us", {
        scopeKey: "test::me",
        storage,
      });
      expect(afterGrant.delivered).toBe(true);
      expect(afterGrant.permissionGranted).toBe(true);
      expect(deliveredLog).toHaveLength(1);

      // 3. Same level again -> deduplicated (no duplicate notification)
      const duplicate = await notifyLowStockItems([HOP_LOW_ITEM], "us", {
        scopeKey: "test::me",
        storage,
      });
      expect(duplicate.newlyAlerted).toHaveLength(0);
      expect(duplicate.delivered).toBe(false);
      expect(deliveredLog).toHaveLength(1);

      // 4. Manual forced alert reuses the same stable scope key (no timestamped leak)
      const manual = await notifyLowStockItems([HOP_LOW_ITEM], "us", {
        scopeKey: "test::me",
        requestPermission: true,
        force: true,
        storage,
      });
      expect(manual.delivered).toBe(true);
      expect(deliveredLog).toHaveLength(2);
      const storedAfterManual = JSON.parse(
        map.get("brewbruvs.notifications.lowStock") ?? "{}",
      ) as Record<string, number>;
      expect(Object.keys(storedAfterManual)).toEqual([`test::me::${HOP_LOW_ITEM.id}`]);

      // 5. Drops even further -> alerts again
      const droppedFurther = { ...HOP_LOW_ITEM, available: 0.01 };
      const third = await notifyLowStockItems([droppedFurther], "us", {
        scopeKey: "test::me",
        storage,
      });
      expect(third.delivered).toBe(true);
      expect(deliveredLog).toHaveLength(3);

      // 6. Restocked above threshold -> prunes tracked entry so a future drop alerts again
      const cleared = await notifyLowStockItems([], "us", {
        scopeKey: "test::me",
        storage,
      });
      expect(cleared.newlyAlerted).toHaveLength(0);
      const storedAfterRestock = JSON.parse(
        map.get("brewbruvs.notifications.lowStock") ?? "{}",
      ) as Record<string, number>;
      expect(Object.keys(storedAfterRestock)).toEqual([]);

      const redropped = await notifyLowStockItems([HOP_LOW_ITEM], "us", {
        scopeKey: "test::me",
        storage,
      });
      expect(redropped.delivered).toBe(true);
      expect(deliveredLog).toHaveLength(4);
    } finally {
      Object.defineProperty(globalThis, "Notification", {
        value: OriginalNotification,
        configurable: true,
        writable: true,
      });
    }
  });
});

describe("InventoryEditorCard", () => {
  it("converts US lb/oz editor inputs to SI kg on create and links catalog items", async () => {
    const onCreate = vi.fn(async (_input: CreateInventoryItemInput) => {});
    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/catalog/hops") {
        return jsonResponse({
          items: [
            {
              id: "hop-columbus",
              catalog: "hops",
              name: "Columbus",
              aliases: ["Zeus"],
              sources: ["bt003"],
              licenses: ["GPL-3.0"],
              notes: null,
              origin: "US",
              hopType: "bittering",
              alphaAcidPct: 16,
              alphaAcidMinPct: 14,
              alphaAcidMaxPct: 17,
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
    }) as unknown as typeof fetch;

    renderWithProviders(
      <InventoryEditorCard
        serverUrl={SERVER_URL}
        authToken="tok"
        breweryId={BREWERY_ID}
        workspaceLabel="Northside Brew Club"
        onCreate={onCreate}
        customFetch={customFetch}
      />,
      "us",
    );

    // Pick hop from catalog -> auto-fills name, catalogId, oz unit, and AA%
    fireEvent.click(screen.getByTestId("inventory-toggle-catalog-picker"));
    fireEvent.click(screen.getByText("Hops"));
    fireEvent.change(screen.getByTestId("inv-catalog-search-input"), {
      target: { value: "Zeus" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("inv-catalog-option-hop-columbus")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("inv-catalog-option-hop-columbus"));

    expect(screen.getByTestId("inventory-linked-catalog-id").textContent).toContain("hop-columbus");
    expect((screen.getByTestId("inventory-aa-input") as HTMLInputElement).value).toBe("16");

    // Enter 4 oz on hand and 2 oz low-stock threshold
    fireEvent.change(screen.getByTestId("inventory-quantity-input"), { target: { value: "4" } });
    fireEvent.change(screen.getByTestId("inventory-threshold-input"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("inventory-location-input"), {
      target: { value: "Freezer" },
    });
    fireEvent.change(screen.getByTestId("inventory-lot-input"), { target: { value: "LOT-Z1" } });
    fireEvent.click(screen.getByTestId("inventory-editor-submit"));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    const payload = onCreate.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    expect(payload?.name).toBe("Columbus");
    expect(payload?.catalogId).toBe("hop-columbus");
    expect(payload?.breweryId).toBe(BREWERY_ID);
    expect(payload?.quantityUnit).toBe("kg");
    expect(payload?.quantity).toBeCloseTo(0.113398, 5);
    expect(payload?.lowStockThreshold).toBeCloseTo(0.056699, 5);
    expect(payload?.alphaAcidPct).toBe(16);
    expect(payload?.location).toBe("Freezer");
    expect(payload?.lot).toBe("LOT-Z1");
  });

  it("preserves exact SI quantities on US metadata-only edits and converts quantity when catalog selection changes unit", async () => {
    const onUpdate = vi.fn(async () => {});
    const { unmount } = renderWithProviders(
      <InventoryEditorCard
        serverUrl={SERVER_URL}
        authToken="tok"
        breweryId={BREWERY_ID}
        workspaceLabel="Northside Brew Club"
        item={MALT_ITEM}
        onUpdate={onUpdate}
      />,
      "us",
    );

    // Unchanged submit in US units -> no rounding drift PATCH
    fireEvent.click(screen.getByTestId("inventory-editor-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("inventory-editor-notice").textContent).toContain("No changes");
    });
    expect(onUpdate).not.toHaveBeenCalled();

    // Update location only in US units -> sends ONLY location, preserving exact 10 kg / 2 kg SI amounts
    fireEvent.change(screen.getByTestId("inventory-location-input"), {
      target: { value: "Shed A" },
    });
    fireEvent.click(screen.getByTestId("inventory-editor-submit"));
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(MALT_ITEM.id, { location: "Shed A" });
    });

    unmount();

    // Enter 1 lb first, then pick a hop from catalog -> converts 1 lb to 16 oz instead of 1 oz
    const onCreate = vi.fn(async (_input: CreateInventoryItemInput) => {});
    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/catalog/hops") {
        return jsonResponse({
          items: [
            {
              id: "hop-columbus",
              catalog: "hops",
              name: "Columbus",
              aliases: ["Zeus"],
              sources: ["bt003"],
              licenses: ["GPL-3.0"],
              notes: null,
              origin: "US",
              hopType: "bittering",
              alphaAcidPct: 16,
              alphaAcidMinPct: 14,
              alphaAcidMaxPct: 17,
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
    }) as unknown as typeof fetch;

    renderWithProviders(
      <InventoryEditorCard
        serverUrl={SERVER_URL}
        authToken="tok"
        breweryId={BREWERY_ID}
        workspaceLabel="Northside Brew Club"
        onCreate={onCreate}
        customFetch={customFetch}
      />,
      "us",
    );

    // Default US unit is lb; enter 1 lb
    fireEvent.change(screen.getByTestId("inventory-quantity-input"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("inventory-toggle-catalog-picker"));
    fireEvent.click(screen.getByText("Hops"));
    fireEvent.change(screen.getByTestId("inv-catalog-search-input"), {
      target: { value: "Columbus" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("inv-catalog-option-hop-columbus")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("inv-catalog-option-hop-columbus"));

    expect((screen.getByTestId("inventory-quantity-input") as HTMLInputElement).value).toBe("16");
    fireEvent.click(screen.getByTestId("inventory-editor-submit"));
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    const created = onCreate.mock.calls[0]?.[0];
    expect(created?.quantityUnit).toBe("kg");
    expect(created?.quantity).toBeCloseTo(0.45359237, 5);
  });

  it("preserves unit and amount when linking an existing 1 L liquid item to a catalog entry", async () => {
    const liquidItem: InventoryItem = {
      ...MALT_ITEM,
      id: "dddddddd-dddd-7ddd-8ddd-dddddddddddd",
      name: "Apple Juice",
      catalogId: null,
      quantity: 1,
      quantityUnit: "l",
      reserved: 0,
      available: 1,
      lowStockThreshold: 0.5,
      lot: null,
      location: "Fridge",
    };
    const onUpdate = vi.fn(async () => {});
    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/catalog/miscs") {
        return jsonResponse({
          items: [
            {
              id: "misc-pectic-enzyme",
              catalog: "miscs",
              name: "Apple Juice",
              aliases: [],
              sources: ["bt001"],
              licenses: ["GPL-3.0"],
              notes: null,
              miscType: "fining",
              useFor: "clarity",
              beverages: ["cider"],
            },
          ],
          nextOffset: null,
        });
      }
      return jsonResponse({ items: [], nextOffset: null });
    }) as unknown as typeof fetch;

    renderWithProviders(
      <InventoryEditorCard
        serverUrl={SERVER_URL}
        authToken="tok"
        breweryId={BREWERY_ID}
        workspaceLabel="Northside Brew Club"
        item={liquidItem}
        onUpdate={onUpdate}
        customFetch={customFetch}
      />,
      "metric",
    );

    fireEvent.click(screen.getByTestId("inventory-toggle-catalog-picker"));
    fireEvent.click(screen.getByText("Misc"));
    fireEvent.change(screen.getByTestId("inv-catalog-search-input"), {
      target: { value: "Apple Juice" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("inv-catalog-option-misc-pectic-enzyme")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("inv-catalog-option-misc-pectic-enzyme"));

    fireEvent.click(screen.getByTestId("inventory-editor-submit"));
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });
    // Must only patch catalogId — never rewrite 1 L into 0.001 kg
    expect(onUpdate).toHaveBeenCalledWith(liquidItem.id, { catalogId: "misc-pectic-enzyme" });
  });
});

describe("InventoryPanel and ShoppingListPanel", () => {
  it("supports scan-friendly search, location chips, low-stock badges, and role gating", async () => {
    const queries: string[] = [];
    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/inventory") {
        queries.push(url.search);
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const items = [MALT_ITEM, HOP_LOW_ITEM].filter(
          (i) =>
            !q ||
            i.name.toLowerCase().includes(q) ||
            (i.lot ?? "").toLowerCase().includes(q) ||
            (i.location ?? "").toLowerCase().includes(q),
        );
        return jsonResponse({ items, nextOffset: null });
      }
      if (url.pathname === "/api/inventory/low-stock") {
        return jsonResponse({ items: [HOP_LOW_ITEM] });
      }
      return jsonResponse({ error: { code: "not_found", message: "Not found" } }, 404);
    }) as unknown as typeof fetch;

    const { unmount } = renderWithProviders(
      <InventoryPanel
        serverUrl={SERVER_URL}
        authToken="tok"
        currentUserId={USER_ID}
        activeBrewery={BREWERY_OWNER}
        breweries={[BREWERY_OWNER]}
        customFetch={customFetch}
      />,
      "us",
    );

    await waitFor(() => {
      expect(screen.getByTestId(`inventory-item-${MALT_ITEM.id}`)).toBeTruthy();
      expect(screen.getByTestId(`inventory-item-${HOP_LOW_ITEM.id}`)).toBeTruthy();
    });
    expect(screen.getByTestId(`low-stock-badge-${HOP_LOW_ITEM.id}`)).toBeTruthy();
    expect(screen.getByTestId(`inventory-owner-badge-${MALT_ITEM.id}`).textContent).toBe(
      "Brewery: Northside Brew Club",
    );
    expect(screen.getByTestId("inventory-add-button")).toBeTruthy();
    expect(screen.getByTestId(`inventory-delete-${MALT_ITEM.id}`)).toBeTruthy();

    // Filter by location chip "Freezer"
    fireEvent.click(screen.getByTestId("inventory-location-chip-Freezer"));
    expect(screen.queryByTestId(`inventory-item-${MALT_ITEM.id}`)).toBeNull();
    expect(screen.getByTestId(`inventory-item-${HOP_LOW_ITEM.id}`)).toBeTruthy();
    fireEvent.click(screen.getByTestId("inventory-location-chip-Freezer"));

    // Scan-friendly search by lot code
    fireEvent.change(screen.getByTestId("inventory-search-input"), {
      target: { value: "LOT-HOP-99" },
    });
    await waitFor(() => {
      expect(queries.some((s) => s.includes("q=LOT-HOP-99"))).toBe(true);
      expect(screen.queryByTestId(`inventory-item-${MALT_ITEM.id}`)).toBeNull();
    });

    unmount();

    // Member role: hides Add, Edit, and Delete controls
    const memberBrewery: Brewery = { ...BREWERY_OWNER, role: "member" };
    renderWithProviders(
      <InventoryPanel
        serverUrl={SERVER_URL}
        authToken="tok"
        currentUserId={USER_ID}
        activeBrewery={memberBrewery}
        breweries={[memberBrewery]}
        customFetch={customFetch}
      />,
      "us",
    );
    await waitFor(() => {
      expect(screen.getByTestId(`inventory-item-${MALT_ITEM.id}`)).toBeTruthy();
    });
    expect(screen.getByTestId("inventory-readonly-role-banner")).toBeTruthy();
    expect(screen.queryByTestId("inventory-add-button")).toBeNull();
    expect(screen.queryByTestId(`inventory-edit-${MALT_ITEM.id}`)).toBeNull();
    expect(screen.queryByTestId(`inventory-delete-${MALT_ITEM.id}`)).toBeNull();
  });

  it("follows nextOffset pagination so later inventory pages appear in list and location filters", async () => {
    const page2Item: InventoryItem = {
      ...HOP_LOW_ITEM,
      id: "cccccccc-cccc-7ccc-8ccc-cccccccccccc",
      name: "Citra Cryo",
      location: "Cold Room",
    };
    const offsetsSeen: string[] = [];
    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/inventory") {
        const offset = url.searchParams.get("offset") ?? "0";
        offsetsSeen.push(offset);
        if (offset === "0") {
          return jsonResponse({ items: [MALT_ITEM], nextOffset: 1 });
        }
        return jsonResponse({ items: [page2Item], nextOffset: null });
      }
      if (url.pathname === "/api/inventory/low-stock") {
        return jsonResponse({ items: [page2Item] });
      }
      return jsonResponse({ error: { code: "not_found", message: "Not found" } }, 404);
    }) as unknown as typeof fetch;

    renderWithProviders(
      <InventoryPanel
        serverUrl={SERVER_URL}
        authToken="tok"
        currentUserId={USER_ID}
        activeBrewery={BREWERY_OWNER}
        breweries={[BREWERY_OWNER]}
        customFetch={customFetch}
      />,
      "us",
    );

    await waitFor(() => {
      expect(screen.getByTestId(`inventory-item-${MALT_ITEM.id}`)).toBeTruthy();
      expect(screen.getByTestId(`inventory-item-${page2Item.id}`)).toBeTruthy();
    });
    expect(offsetsSeen).toEqual(["0", "1"]);
    fireEvent.click(screen.getByTestId("inventory-location-chip-Cold Room"));
    expect(screen.queryByTestId(`inventory-item-${MALT_ITEM.id}`)).toBeNull();
    expect(screen.getByTestId(`inventory-item-${page2Item.id}`)).toBeTruthy();
  });

  it("scopes batch inventory navigation links to the batch owner across workspaces", () => {
    expect(buildBatchInventoryHref({ type: "brewery", id: BREWERY_ID }, "shopping")).toBe(
      `/inventory?tab=shopping&breweryId=${BREWERY_ID}`,
    );
    expect(buildBatchInventoryHref({ type: "user", id: USER_ID }, "stock")).toBe(
      "/inventory?tab=stock&scope=me",
    );
    expect(
      canAccessOwnerInventory({ type: "brewery", id: BREWERY_ID }, USER_ID, [BREWERY_OWNER]),
    ).toBe(true);
    expect(canAccessOwnerInventory({ type: "user", id: USER_ID }, USER_ID, [])).toBe(true);
    expect(canAccessOwnerInventory({ type: "user", id: "other-user" }, USER_ID, [])).toBe(false);

    // Opening a brewery batch while workspace is "Me" resolves to the brewery immediately
    expect(
      resolveInventoryBrewery({
        activeBrewery: null,
        breweries: [BREWERY_OWNER],
        paramBreweryId: BREWERY_ID,
        paramScope: undefined,
        routeOverrideActive: true,
      }),
    ).toEqual(BREWERY_OWNER);

    // Opening a personal batch while workspace is a brewery resolves to "Me" (null)
    expect(
      resolveInventoryBrewery({
        activeBrewery: BREWERY_OWNER,
        breweries: [BREWERY_OWNER],
        paramBreweryId: undefined,
        paramScope: "me",
        routeOverrideActive: true,
      }),
    ).toBeNull();

    // Once user switches manually (routeOverrideActive=false), activeBrewery wins
    expect(
      resolveInventoryBrewery({
        activeBrewery: null,
        breweries: [BREWERY_OWNER],
        paramBreweryId: BREWERY_ID,
        paramScope: undefined,
        routeOverrideActive: false,
      }),
    ).toBeNull();
  });

  it("renders shopping list shortfalls with planned batch links and low-stock restock controls", async () => {
    const shopping: ShoppingList = {
      short: [
        {
          name: "Safale US-05",
          catalogId: "yeast-fermentis-us-05",
          unit: "each",
          short: 1,
          batches: [{ id: "batch-123", name: "Saturday Pale" }],
        },
      ],
      lowStock: [HOP_LOW_ITEM],
    };
    const customFetch = vi.fn(async () => jsonResponse(shopping)) as unknown as typeof fetch;
    const onOpenBatch = vi.fn();
    const onRestock = vi.fn();

    renderWithProviders(
      <ShoppingListPanel
        serverUrl={SERVER_URL}
        authToken="tok"
        currentUserId={USER_ID}
        activeBrewery={BREWERY_OWNER}
        breweries={[BREWERY_OWNER]}
        onOpenBatch={onOpenBatch}
        onRestockItem={onRestock}
        customFetch={customFetch}
      />,
      "us",
    );

    await waitFor(() => {
      expect(screen.getByTestId("shopping-short-item-0")).toBeTruthy();
      expect(screen.getByTestId(`shopping-lowstock-item-${HOP_LOW_ITEM.id}`)).toBeTruthy();
    });
    expect(screen.getByTestId("shopping-short-item-0").textContent).toContain("Need 1 each");
    fireEvent.click(screen.getByTestId("shopping-batch-link-batch-123"));
    expect(onOpenBatch).toHaveBeenCalledWith("batch-123");

    fireEvent.click(screen.getByTestId(`shopping-restock-${HOP_LOW_ITEM.id}`));
    expect(onRestock).toHaveBeenCalledWith(HOP_LOW_ITEM);
  });
});

describe("BatchInventoryChangeBanner and BatchInventorySection", () => {
  it("shows what got reserved and what is short when starting a batch", () => {
    const change: InventoryChange = {
      reserved: [
        {
          itemId: MALT_ITEM.id,
          name: "Pale Malt (2 Row) US",
          quantity: 4.5,
          unit: "kg",
          state: "reserved",
        },
      ],
      short: [
        {
          name: "Columbus",
          catalogId: "hop-columbus",
          unit: "kg",
          short: 0.0283495,
        },
      ],
      used: false,
      released: false,
    };
    const onOpenShopping = vi.fn();

    renderWithProviders(
      <BatchInventoryChangeBanner change={change} onOpenShoppingList={onOpenShopping} />,
      "us",
    );

    expect(screen.getByTestId("batch-inventory-reserved-summary").textContent).toContain(
      "9.92 lb reserved",
    );
    expect(screen.getByTestId("batch-inventory-short-summary").textContent).toContain(
      "Short 1.00 oz",
    );
    fireEvent.click(screen.getByTestId("batch-open-shopping-list-button"));
    expect(onOpenShopping).toHaveBeenCalledTimes(1);
  });

  it("renders batch reservations, lot-adjusted stats, and hop AA overrides", () => {
    const batch: BatchDetail = {
      id: "batch-1",
      uri: `${SERVER_URL}/batches/batch-1`,
      name: "Club Pale",
      beverage: "beer",
      status: "brewing",
      visibility: "private",
      owner: { type: "brewery", id: BREWERY_ID },
      recipe: { id: "rec-1", version: 1, versionId: "ver-1" },
      batchSizeL: 18.927,
      equipmentProfileId: null,
      brewedAt: "2026-11-10T10:00:00Z",
      completedAt: null,
      createdAt: "2026-11-10T09:00:00Z",
      updatedAt: "2026-11-10T10:00:00Z",
      statusHistory: [],
      allowedStatuses: ["fermenting"],
      can: { contribute: true, edit: true, delete: true, share: true },
    };
    const reservations: Reservation[] = [
      {
        itemId: MALT_ITEM.id,
        name: "Pale Malt (2 Row) US",
        quantity: 4.5,
        unit: "kg",
        state: "reserved",
      },
    ];
    const stats: BatchStats = {
      stats: {
        og: 1.055,
        fg: 1.012,
        abvPct: 5.64,
        ibu: 42,
        colorSrm: 6.5,
        colorEbc: 12.8,
      },
      statsError: null,
      alphaAcidFromInventory: [{ hop: "Columbus", alphaAcidPct: 16.5, itemId: HOP_LOW_ITEM.id }],
    };

    renderWithProviders(
      <BatchInventorySection batch={batch} reservations={reservations} stats={stats} />,
      "us",
    );

    expect(screen.getByTestId("batch-reservation-item-0").textContent).toContain("9.92 lb");
    expect(screen.getByTestId("batch-stats-values").textContent).toContain("1.055");
    expect(screen.getByTestId("batch-stats-values").textContent).toContain("6.5 SRM");
    expect(screen.getByTestId("batch-inventory-aa-overrides").textContent).toContain(
      "Columbus: 16.5% AA",
    );
  });
});
