// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityPage } from "../src/api/activity";
import { fetchBatches } from "../src/api/batches";
import type { Brewery, BreweryDetail } from "../src/api/breweries";
import type { EquipmentItem } from "../src/api/equipment";
import { fetchRecipes } from "../src/api/recipes";
import type { Share, ShareableResourceType } from "../src/api/sharing";
import { BreweryActivityFeed } from "../src/components/breweries/BreweryActivityFeed";
import { BreweryDetailView } from "../src/components/breweries/BreweryDetailView";
import { EquipmentEditorCard } from "../src/components/equipment/EquipmentEditorCard";
import { EquipmentPanel } from "../src/components/equipment/EquipmentPanel";
import { ShareDialog } from "../src/components/sharing/ShareDialog";
import { UnitsProvider } from "../src/state/units";

const SERVER_URL = "http://localhost:8080";
const USER_ID = "01950000-0000-7000-8000-000000000001";
const OTHER_USER_ID = "01950000-0000-7000-8000-000000000002";
const BREWERY_A_ID = "01950000-0000-7000-8000-0000000000a1";
const BREWERY_B_ID = "01950000-0000-7000-8000-0000000000b2";
const EQUIP_ID = "01950000-0000-7000-8000-0000000000e1";
const BATCH_ID = "01950000-0000-7000-8000-0000000000ba";

const BREWERY_A: Brewery = {
  id: BREWERY_A_ID,
  uri: `${SERVER_URL}/breweries/${BREWERY_A_ID}`,
  name: "Northside Brew Club",
  description: "Shared neighborhood club",
  city: "Portland",
  state: "OR",
  role: "owner",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

const BREWERY_B: Brewery = {
  id: BREWERY_B_ID,
  uri: `${SERVER_URL}/breweries/${BREWERY_B_ID}`,
  name: "Eastside Cider Guild",
  description: null,
  city: "Seattle",
  state: "WA",
  role: "brewer",
  createdAt: "2026-11-02T00:00:00Z",
  updatedAt: "2026-11-02T00:00:00Z",
};

const BREWERY_A_DETAIL: BreweryDetail = {
  ...BREWERY_A,
  members: [
    {
      userId: USER_ID,
      displayName: "Alice Owner",
      role: "owner",
      joinedAt: "2026-11-01T00:00:00Z",
    },
    {
      userId: OTHER_USER_ID,
      displayName: "Bob Brewer",
      role: "brewer",
      joinedAt: "2026-11-02T00:00:00Z",
    },
  ],
};

const SAMPLE_EQUIPMENT: EquipmentItem = {
  id: EQUIP_ID,
  uri: `${SERVER_URL}/equipment/${EQUIP_ID}`,
  catalogId: null,
  owner: { type: "brewery", id: BREWERY_A_ID },
  visibility: "private",
  name: "20 gal Stainless Kettle",
  type: "Kettle",
  condition: "good",
  notes: "Tri-clamp ball valve",
  heldByUserId: null,
  batchSizeL: 18.92705892,
  boilSizeL: null,
  kettleVolumeL: 75.70823568,
  kettleLossL: null,
  boilRateLPerHr: 3.785411784,
  mashTunVolumeL: null,
  grainAbsorptionLPerKg: null,
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: "2026-11-05T00:00:00Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  if (status === 204) return new Response(null, { status: 204 });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderWithProviders(ui: ReactNode, unitSystem: "us" | "metric" = "us") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UnitsProvider initialUnitSystem={unitSystem}>{ui}</UnitsProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("Unified ShareDialog", () => {
  it.each<[ShareableResourceType, string, string]>([
    ["recipe", "/api/recipes/res-1", "PATCH"],
    ["batch", "/api/batches/res-1/visibility", "PUT"],
    ["note", "/api/notes/res-1/visibility", "PUT"],
    ["inventory_item", "/api/inventory/res-1/visibility", "PUT"],
    ["equipment_item", "/api/equipment/res-1/visibility", "PUT"],
  ])(
    "updates visibility and shares %s with people and breweries (read or edit)",
    async (resourceType, expectedVisPath, expectedVisMethod) => {
      const shares: Share[] = [];
      const calls: { method: string; path: string; body: unknown }[] = [];

      const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const url = new URL(req.url);
        const bodyText =
          req.method !== "GET" && req.method !== "DELETE" ? await req.clone().text() : "";
        const body = bodyText ? JSON.parse(bodyText) : undefined;
        calls.push({ method: req.method, path: url.pathname, body });

        if (url.pathname === expectedVisPath && req.method === expectedVisMethod) {
          return jsonResponse({ id: "res-1", visibility: body.visibility });
        }
        if (url.pathname.endsWith("/shares") && req.method === "GET") {
          return jsonResponse(shares);
        }
        if (url.pathname.endsWith("/shares") && req.method === "POST") {
          const created: Share = body.email
            ? {
                id: "share-user-1",
                user: { id: OTHER_USER_ID, displayName: "Bob Brewer" },
                breweryId: null,
                level: body.level,
                createdAt: "2026-11-10T00:00:00Z",
              }
            : {
                id: "share-brewery-1",
                user: null,
                breweryId: body.breweryId,
                level: body.level,
                createdAt: "2026-11-10T00:00:00Z",
              };
          const idx = shares.findIndex((s) => s.id === created.id);
          if (idx >= 0) shares[idx] = created;
          else shares.push(created);
          return jsonResponse(created, 201);
        }
        if (url.pathname.includes("/shares/") && req.method === "DELETE") {
          const shareId = url.pathname.split("/").pop();
          const idx = shares.findIndex((s) => s.id === shareId);
          if (idx >= 0) shares.splice(idx, 1);
          return jsonResponse(null, 204);
        }
        return jsonResponse({});
      }) as unknown as typeof fetch;

      renderWithProviders(
        <ShareDialog
          open
          onClose={() => {}}
          serverUrl={SERVER_URL}
          authToken="tok"
          resourceType={resourceType}
          resourceId="res-1"
          resourceName="Shared Resource"
          visibility={resourceType === "inventory_item" ? null : "private"}
          owner={{ type: "brewery", id: BREWERY_A_ID }}
          canManage
          breweries={[BREWERY_A, BREWERY_B]}
          customFetch={customFetch}
        />,
      );

      // Update visibility to server
      fireEvent.click(screen.getByLabelText("Server members visibility"));
      fireEvent.click(screen.getByTestId("save-visibility-button"));
      await waitFor(() => {
        expect(screen.getByTestId("visibility-status").textContent).toContain("server");
      });
      expect(
        calls.some(
          (c) =>
            c.method === expectedVisMethod &&
            c.path === expectedVisPath &&
            (c.body as { visibility?: string })?.visibility === "server",
        ),
      ).toBe(true);

      // Share with a person by email (Can edit)
      fireEvent.change(screen.getByTestId("share-email-input"), {
        target: { value: "bob@example.com" },
      });
      fireEvent.click(screen.getByLabelText("Editable share"));
      fireEvent.click(screen.getByTestId("add-share-button"));
      await waitFor(() => {
        expect(screen.getByTestId("share-row-share-user-1").textContent).toContain("Bob Brewer");
      });
      expect(screen.getByTestId("share-row-share-user-1").textContent).toContain("Can edit");

      // Switch to Brewery target — owning brewery (BREWERY_A) is omitted, BREWERY_B is offered
      fireEvent.click(screen.getByLabelText("Share with a brewery"));
      expect(screen.queryByTestId(`share-brewery-option-${BREWERY_A_ID}`)).toBeNull();
      fireEvent.click(screen.getByTestId(`share-brewery-option-${BREWERY_B_ID}`));
      fireEvent.click(screen.getByLabelText("Read-only share"));
      fireEvent.click(screen.getByTestId("add-share-button"));
      await waitFor(() => {
        expect(screen.getByTestId("share-row-share-brewery-1").textContent).toContain(
          "Eastside Cider Guild",
        );
      });
      expect(screen.getByTestId("share-row-share-brewery-1").textContent).toContain("Read only");

      // Remove user share
      fireEvent.click(screen.getByTestId("remove-share-share-user-1"));
      await waitFor(() => {
        expect(screen.queryByTestId("share-row-share-user-1")).toBeNull();
      });
    },
  );
});

describe("EquipmentPanel and EquipmentEditorCard", () => {
  it("lists brewery equipment, shows Held by, lends to a member, and marks returned", async () => {
    let currentItem: EquipmentItem = { ...SAMPLE_EQUIPMENT };
    const holderCalls: Array<{ heldByUserId: string | null }> = [];

    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/equipment" && req.method === "GET") {
        expect(url.searchParams.get("breweryId")).toBe(BREWERY_A_ID);
        return jsonResponse({ items: [currentItem], nextOffset: null });
      }
      if (url.pathname === `/api/breweries/${BREWERY_A_ID}` && req.method === "GET") {
        return jsonResponse(BREWERY_A_DETAIL);
      }
      if (url.pathname === `/api/equipment/${EQUIP_ID}/holder` && req.method === "PUT") {
        const body = JSON.parse(await req.clone().text()) as { heldByUserId: string | null };
        holderCalls.push(body);
        currentItem = { ...currentItem, heldByUserId: body.heldByUserId };
        return jsonResponse(currentItem);
      }
      return jsonResponse({});
    }) as unknown as typeof fetch;

    renderWithProviders(
      <EquipmentPanel
        serverUrl={SERVER_URL}
        authToken="tok"
        currentUserId={USER_ID}
        activeBrewery={BREWERY_A}
        breweries={[BREWERY_A]}
        customFetch={customFetch}
      />,
      "us",
    );

    await waitFor(() => {
      expect(screen.getByTestId(`equipment-item-${EQUIP_ID}`)).toBeTruthy();
    });
    // Volumes render in US gallons (20 gal kettle, 5 gal batch)
    expect(screen.getByTestId("equipment-list").textContent).toContain("20.00 gal");
    expect(screen.getByTestId(`equipment-holder-${EQUIP_ID}`).textContent).toContain(
      "Available at brewery",
    );

    // Lend to Bob Brewer
    fireEvent.click(screen.getByTestId(`equipment-lend-${EQUIP_ID}`));
    await waitFor(() => {
      expect(screen.getByTestId(`equipment-lend-member-${EQUIP_ID}-${OTHER_USER_ID}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`equipment-lend-member-${EQUIP_ID}-${OTHER_USER_ID}`));

    await waitFor(() => {
      expect(screen.getByTestId(`equipment-holder-${EQUIP_ID}`).textContent).toContain(
        "Held by Bob Brewer",
      );
    });
    expect(holderCalls[0]).toEqual({ heldByUserId: OTHER_USER_ID });

    // Mark returned
    fireEvent.click(screen.getByTestId(`equipment-return-${EQUIP_ID}`));
    await waitFor(() => {
      expect(screen.getByTestId(`equipment-holder-${EQUIP_ID}`).textContent).toContain(
        "Available at brewery",
      );
    });
    expect(holderCalls[1]).toEqual({ heldByUserId: null });
  });

  it("hides add/edit/lend/delete/share controls for Member and Viewer roles", async () => {
    const memberBrewery: Brewery = { ...BREWERY_A, role: "member" };
    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/equipment") {
        return jsonResponse({
          items: [{ ...SAMPLE_EQUIPMENT, heldByUserId: OTHER_USER_ID }],
          nextOffset: null,
        });
      }
      if (url.pathname === `/api/breweries/${BREWERY_A_ID}`) {
        return jsonResponse({ ...BREWERY_A_DETAIL, role: "member" });
      }
      return jsonResponse({});
    }) as unknown as typeof fetch;

    renderWithProviders(
      <EquipmentPanel
        serverUrl={SERVER_URL}
        authToken="tok"
        currentUserId={USER_ID}
        activeBrewery={memberBrewery}
        breweries={[memberBrewery]}
        customFetch={customFetch}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId(`equipment-holder-${EQUIP_ID}`).textContent).toContain(
        "Held by Bob Brewer",
      );
    });
    expect(screen.getByTestId("equipment-readonly-role-banner")).toBeTruthy();
    expect(screen.queryByTestId("equipment-add-button")).toBeNull();
    expect(screen.queryByTestId(`equipment-lend-${EQUIP_ID}`)).toBeNull();
    expect(screen.queryByTestId(`equipment-edit-${EQUIP_ID}`)).toBeNull();
    expect(screen.queryByTestId(`equipment-delete-${EQUIP_ID}`)).toBeNull();
    expect(screen.queryByTestId(`equipment-share-${EQUIP_ID}`)).toBeNull();
  });

  it("preserves exact SI volumes when editing only metadata in US units", async () => {
    const onUpdate = vi.fn(async () => {});
    const itemWithExactSi: EquipmentItem = {
      ...SAMPLE_EQUIPMENT,
      kettleVolumeL: 37.85411784,
      batchSizeL: 18.92705892,
    };

    renderWithProviders(
      <EquipmentEditorCard
        serverUrl={SERVER_URL}
        authToken="tok"
        breweryId={BREWERY_A_ID}
        workspaceLabel="Northside Brew Club"
        item={itemWithExactSi}
        onUpdate={onUpdate}
      />,
      "us",
    );

    fireEvent.change(screen.getByTestId("equipment-notes-input"), {
      target: { value: "Replaced silicone gasket" },
    });
    fireEvent.click(screen.getByTestId("equipment-editor-submit"));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });
    expect(onUpdate).toHaveBeenCalledWith(EQUIP_ID, { notes: "Replaced silicone gasket" });
  });
});

describe("BreweryActivityFeed", () => {
  it("renders all brewery activity verbs, supports Load more pagination, and shows for Viewers", async () => {
    const page1: ActivityPage = {
      items: [
        {
          id: "ev-1",
          verb: "item_lent",
          at: "2026-11-12T15:00:00Z",
          actor: { id: USER_ID, displayName: "Alice Owner" },
          object: { type: "equipment_item", id: EQUIP_ID },
          batch: null,
          status: null,
          name: "20 gal Stainless Kettle",
        },
        {
          id: "ev-2",
          verb: "batch_started",
          at: "2026-11-12T14:00:00Z",
          actor: { id: OTHER_USER_ID, displayName: "Bob Brewer" },
          object: { type: "batch_status_change", id: "sc-1" },
          batch: { id: BATCH_ID, name: "Club Pale Ale" },
          status: "brewing",
          name: null,
        },
      ],
      nextOffset: 2,
    };
    const page2: ActivityPage = {
      items: [
        {
          id: "ev-3",
          verb: "member_joined",
          at: "2026-11-11T10:00:00Z",
          actor: { id: OTHER_USER_ID, displayName: "Bob Brewer" },
          object: { type: "user", id: OTHER_USER_ID },
          batch: null,
          status: null,
          name: "Bob Brewer",
        },
      ],
      nextOffset: null,
    };

    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === `/api/breweries/${BREWERY_A_ID}/activity`) {
        const offset = Number(url.searchParams.get("offset") ?? "0");
        return jsonResponse(offset === 0 ? page1 : page2);
      }
      if (url.pathname === "/api/inventory") {
        return jsonResponse({ items: [], nextOffset: null });
      }
      return jsonResponse({});
    }) as unknown as typeof fetch;

    const onOpenBatch = vi.fn();
    renderWithProviders(
      <BreweryActivityFeed
        serverUrl={SERVER_URL}
        authToken="tok"
        breweryId={BREWERY_A_ID}
        breweryName="Northside Brew Club"
        pageSize={2}
        onOpenBatch={onOpenBatch}
        customFetch={customFetch}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("activity-event-ev-1")).toBeTruthy();
    });
    expect(screen.getByTestId("activity-event-ev-1").textContent).toContain(
      "Alice Owner lent out 20 gal Stainless Kettle.",
    );
    expect(screen.getByTestId("activity-event-ev-2").textContent).toContain(
      "Bob Brewer started batch Club Pale Ale",
    );

    fireEvent.click(screen.getByTestId("activity-event-ev-2"));
    expect(onOpenBatch).toHaveBeenCalledWith(BATCH_ID);

    fireEvent.click(screen.getByTestId("activity-load-more"));
    await waitFor(() => {
      expect(screen.getByTestId("activity-event-ev-3")).toBeTruthy();
    });
    expect(screen.getByTestId("activity-event-ev-3").textContent).toContain(
      "Bob Brewer joined the brewery.",
    );
    expect(screen.queryByTestId("activity-load-more")).toBeNull();

    // Viewer role also sees the activity feed inside BreweryDetailView (without owner controls)
    cleanup();
    const viewerDetail: BreweryDetail = { ...BREWERY_A_DETAIL, role: "viewer" };
    renderWithProviders(
      <BreweryDetailView
        serverUrl={SERVER_URL}
        authToken="tok"
        currentUserId={USER_ID}
        detail={viewerDetail}
        customFetch={customFetch}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("brewery-activity-feed")).toBeTruthy();
      expect(screen.getByTestId("activity-event-ev-1")).toBeTruthy();
    });
    expect(screen.queryByTestId("brewery-invites-section")).toBeNull();
  });
});

describe("Server-side breweryId filter for recipes and batches (#82)", () => {
  it("passes breweryId (without mine=true) and follows nextOffset pagination on GET /api/recipes", async () => {
    const requestedUrls: string[] = [];
    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      requestedUrls.push(req.url);
      const url = new URL(req.url);
      const offset = Number(url.searchParams.get("offset") ?? "0");
      if (offset === 0) {
        return jsonResponse({
          items: [{ id: "r1", name: "Page 1 Club Ale" }],
          nextOffset: 100,
        });
      }
      return jsonResponse({
        items: [{ id: "r2", name: "Page 2 Club Stout" }],
        nextOffset: null,
      });
    }) as unknown as typeof fetch;

    const items = await fetchRecipes(
      SERVER_URL,
      "tok",
      { breweryId: BREWERY_A_ID, mine: true },
      customFetch,
    );
    expect(items.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(requestedUrls).toHaveLength(2);
    const first = new URL(requestedUrls[0] as string);
    expect(first.searchParams.get("breweryId")).toBe(BREWERY_A_ID);
    expect(first.searchParams.get("mine")).toBeNull();
    expect(first.searchParams.get("offset")).toBe("0");
    const second = new URL(requestedUrls[1] as string);
    expect(second.searchParams.get("breweryId")).toBe(BREWERY_A_ID);
    expect(second.searchParams.get("offset")).toBe("100");
  });

  it("passes breweryId (without mine=true) and follows nextOffset pagination on GET /api/batches", async () => {
    const requestedUrls: string[] = [];
    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      requestedUrls.push(req.url);
      const url = new URL(req.url);
      const offset = Number(url.searchParams.get("offset") ?? "0");
      if (offset === 0) {
        return jsonResponse({
          items: [{ id: "b1", name: "Club Batch 1" }],
          nextOffset: 100,
        });
      }
      return jsonResponse({
        items: [{ id: "b2", name: "Club Batch 2" }],
        nextOffset: null,
      });
    }) as unknown as typeof fetch;

    const items = await fetchBatches(
      SERVER_URL,
      "tok",
      { breweryId: BREWERY_A_ID, mine: true, status: "fermenting" },
      customFetch,
    );
    expect(items.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(requestedUrls).toHaveLength(2);
    const first = new URL(requestedUrls[0] as string);
    expect(first.searchParams.get("breweryId")).toBe(BREWERY_A_ID);
    expect(first.searchParams.get("status")).toBe("fermenting");
    expect(first.searchParams.get("mine")).toBeNull();
  });
});
