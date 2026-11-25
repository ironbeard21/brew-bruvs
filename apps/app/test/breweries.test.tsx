// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Pressable, Text } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Note, Reading } from "../src/api/batches";
import type { Brewery, BreweryDetail, BreweryInvite } from "../src/api/breweries";
import type { InventoryItem } from "../src/api/inventory";
import type { RecipeDetail } from "../src/api/recipes";
import { BatchNotesSection } from "../src/components/batches/BatchNotesSection";
import { ReadingsSection } from "../src/components/batches/ReadingsSection";
import { BreweryDetailView } from "../src/components/breweries/BreweryDetailView";
import { BreweryHub } from "../src/components/breweries/BreweryHub";
import { formatInventoryQuantity } from "../src/components/breweries/InventoryPreviewCard";
import { MoveToBreweryBar, OwnerPickerCard } from "../src/components/breweries/OwnerPickerCard";
import { OwnerBadge } from "../src/components/OwnerBadge";
import { RecipeBuilder } from "../src/components/recipes/RecipeBuilder";
import { BreweryProvider, useBrewery } from "../src/state/brewery";
import {
  canContributeBrewery,
  canManageBrewery,
  canPerformOnOwner,
  canWriteBrewery,
  formatOwnerLabel,
} from "../src/state/permissions";
import { ServerProvider } from "../src/state/server";
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

function BreweryProbe() {
  const { activeBrewery, breweries, setActiveBreweryId } = useBrewery();
  return (
    <>
      <Text testID="probe-active">{activeBrewery?.name ?? "Me"}</Text>
      <Text testID="probe-count">{breweries.length}</Text>
      <Pressable testID="probe-select" onPress={() => setActiveBreweryId(BREWERY_A_ID)}>
        <Text>Select</Text>
      </Pressable>
    </>
  );
}

const SERVER_URL = "https://brew.example.test";
const USER_OWNER = "00000000-0000-7000-8000-000000000001";
const USER_BREWER = "00000000-0000-7000-8000-000000000002";
const USER_MEMBER = "00000000-0000-7000-8000-000000000003";
const USER_VIEWER = "00000000-0000-7000-8000-000000000004";
const BREWERY_A_ID = "11111111-1111-7111-8111-111111111111";
const BREWERY_B_ID = "22222222-2222-7222-8222-222222222222";

const SAMPLE_BREWERY_DETAIL: BreweryDetail = {
  id: BREWERY_A_ID,
  uri: `${SERVER_URL}/breweries/${BREWERY_A_ID}`,
  name: "Northside Brew Club",
  description: "Shared neighborhood brew house",
  city: "Portland",
  state: "OR",
  role: "owner",
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
  members: [
    {
      userId: USER_OWNER,
      displayName: "Alice Owner",
      role: "owner",
      joinedAt: "2026-11-01T10:00:00Z",
    },
    {
      userId: USER_BREWER,
      displayName: "Bob Brewer",
      role: "brewer",
      joinedAt: "2026-11-02T10:00:00Z",
    },
    {
      userId: USER_MEMBER,
      displayName: "Cara Member",
      role: "member",
      joinedAt: "2026-11-03T10:00:00Z",
    },
  ],
};

const SAMPLE_RECIPE: RecipeDetail = {
  id: "33333333-3333-7333-8333-333333333333",
  uri: `${SERVER_URL}/recipes/33333333-3333-7333-8333-333333333333`,
  name: "Club House Pale",
  beverage: "beer",
  visibility: "private",
  owner: { type: "brewery", id: BREWERY_A_ID },
  credit: null,
  forkedFrom: null,
  publicSharingBlocked: false,
  latestVersion: 1,
  createdAt: "2026-11-01T12:00:00Z",
  updatedAt: "2026-11-01T12:00:00Z",
  version: {
    id: "44444444-4444-7444-8444-444444444444",
    version: 1,
    name: "Club House Pale",
    beverage: "beer",
    styleId: null,
    batchSizeL: 18.927,
    equipmentProfileId: null,
    createdAt: "2026-11-01T12:00:00Z",
    stats: null,
    statsError: null,
    styleFit: null,
    content: {
      schemaVersion: 1,
      efficiencyPct: 72,
      boilTimeMin: 60,
      fermentables: [{ name: "Pale Malt", kind: "grain", amountKg: 4.5, use: "mash" }],
      hops: [],
      yeasts: [],
      miscs: [],
      mash: [],
      fermentation: [],
    },
  },
};

describe("brewery permission helpers and owner formatting", () => {
  const memberships: Pick<Brewery, "id" | "name" | "role">[] = [
    { id: BREWERY_A_ID, name: "Northside Brew Club", role: "owner" },
    { id: BREWERY_B_ID, name: "Eastside Collective", role: "brewer" },
    { id: "33333333-0000-7000-8000-000000000000", name: "Member Club", role: "member" },
    { id: "44444444-0000-7000-8000-000000000000", name: "Viewer Club", role: "viewer" },
  ];

  it("enforces every role capability matching server permissions.ts", () => {
    const ownerObj = { type: "brewery" as const, id: BREWERY_A_ID };
    const brewerObj = { type: "brewery" as const, id: BREWERY_B_ID };
    const memberObj = {
      type: "brewery" as const,
      id: "33333333-0000-7000-8000-000000000000",
    };
    const viewerObj = {
      type: "brewery" as const,
      id: "44444444-0000-7000-8000-000000000000",
    };

    expect(canManageBrewery("owner")).toBe(true);
    expect(canManageBrewery("brewer")).toBe(false);
    expect(canWriteBrewery("owner")).toBe(true);
    expect(canWriteBrewery("brewer")).toBe(true);
    expect(canWriteBrewery("member")).toBe(false);
    expect(canContributeBrewery("member")).toBe(true);
    expect(canContributeBrewery("viewer")).toBe(false);

    // Owner: all 5 actions
    for (const action of ["read", "contribute", "edit", "delete", "share"] as const) {
      expect(canPerformOnOwner(USER_OWNER, memberships, ownerObj, action)).toBe(true);
    }
    // Brewer: read, contribute, edit — NOT delete or share
    expect(canPerformOnOwner(USER_OWNER, memberships, brewerObj, "edit")).toBe(true);
    expect(canPerformOnOwner(USER_OWNER, memberships, brewerObj, "contribute")).toBe(true);
    expect(canPerformOnOwner(USER_OWNER, memberships, brewerObj, "delete")).toBe(false);
    expect(canPerformOnOwner(USER_OWNER, memberships, brewerObj, "share")).toBe(false);
    // Member: read, contribute — NOT edit, delete, share
    expect(canPerformOnOwner(USER_OWNER, memberships, memberObj, "contribute")).toBe(true);
    expect(canPerformOnOwner(USER_OWNER, memberships, memberObj, "edit")).toBe(false);
    expect(canPerformOnOwner(USER_OWNER, memberships, memberObj, "delete")).toBe(false);
    // Viewer: read only
    expect(canPerformOnOwner(USER_OWNER, memberships, viewerObj, "read")).toBe(true);
    expect(canPerformOnOwner(USER_OWNER, memberships, viewerObj, "contribute")).toBe(false);
    expect(canPerformOnOwner(USER_OWNER, memberships, viewerObj, "edit")).toBe(false);
    // Personal ownership
    expect(
      canPerformOnOwner(USER_OWNER, memberships, { type: "user", id: USER_OWNER }, "delete"),
    ).toBe(true);
    expect(
      canPerformOnOwner(USER_OWNER, memberships, { type: "user", id: USER_BREWER }, "edit"),
    ).toBe(false);
  });

  it("formats owner badges and inventory quantities in US and Metric units", () => {
    expect(formatOwnerLabel({ type: "user", id: USER_OWNER }, USER_OWNER, memberships)).toEqual({
      label: "Mine",
      isBrewery: false,
      isPersonal: true,
    });
    expect(
      formatOwnerLabel({ type: "brewery", id: BREWERY_A_ID }, USER_OWNER, memberships),
    ).toEqual({
      label: "Northside Brew Club",
      isBrewery: true,
      isPersonal: false,
    });
    expect(formatOwnerLabel({ type: "user", id: USER_BREWER }, USER_OWNER, memberships)).toEqual({
      label: "Shared",
      isBrewery: false,
      isPersonal: false,
    });

    expect(formatInventoryQuantity(1, "kg", "metric")).toBe("1.00 kg");
    expect(formatInventoryQuantity(1, "kg", "us")).toBe("2.20 lb");
    expect(formatInventoryQuantity(3.785411784, "l", "us")).toBe("1.00 gal");
    expect(formatInventoryQuantity(2, "each", "us")).toBe("2 each");
  });

  it("renders OwnerBadge with brewery and personal labels", () => {
    render(
      <>
        <OwnerBadge
          owner={{ type: "user", id: USER_OWNER }}
          currentUserId={USER_OWNER}
          breweries={memberships}
          testID="badge-mine"
        />
        <OwnerBadge
          owner={{ type: "brewery", id: BREWERY_A_ID }}
          currentUserId={USER_OWNER}
          breweries={memberships}
          testID="badge-brewery"
        />
      </>,
    );
    expect(screen.getByTestId("badge-mine").textContent).toBe("Mine");
    expect(screen.getByTestId("badge-brewery").textContent).toBe("Brewery: Northside Brew Club");
  });
});

describe("BreweryHub workflows", () => {
  it("creates a brewery, accepts/declines invites, joins by code, and shows owned inventory", async () => {
    const pendingInvite: BreweryInvite = {
      id: "55555555-5555-7555-8555-555555555555",
      brewery: { id: BREWERY_B_ID, name: "Eastside Collective" },
      role: "brewer",
      email: "alice@brew.test",
      createdAt: "2026-11-10T10:00:00Z",
      expiresAt: "2026-11-17T10:00:00Z",
    };
    const breweryInventory: InventoryItem = {
      id: "66666666-6666-7666-8666-666666666666",
      uri: `${SERVER_URL}/inventory/66666666-6666-7666-8666-666666666666`,
      owner: { type: "brewery", id: BREWERY_A_ID },
      name: "Maris Otter Malt",
      catalogId: null,
      quantity: 10,
      quantityUnit: "kg",
      reserved: 2,
      available: 8,
      lot: null,
      location: "Grain room",
      alphaAcidPct: null,
      purchasedOn: null,
      bestBefore: null,
      lowStockThreshold: null,
      notes: null,
      createdAt: "2026-11-01T10:00:00Z",
      updatedAt: "2026-11-01T10:00:00Z",
    };

    const requests: { method: string; url: string; body?: unknown }[] = [];
    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      const method = req.method;
      const bodyText = method !== "GET" && method !== "DELETE" ? await req.text() : "";
      const parsedBody = bodyText ? JSON.parse(bodyText) : undefined;
      requests.push({ method, url: `${url.pathname}${url.search}`, body: parsedBody });

      if (url.pathname === "/api/brewery-invites" && method === "GET") {
        return jsonResponse({ items: [pendingInvite] });
      }
      if (url.pathname === "/api/inventory" && method === "GET") {
        if (url.searchParams.get("breweryId") === BREWERY_A_ID) {
          return jsonResponse({ items: [breweryInventory], nextOffset: null });
        }
        return jsonResponse({ items: [], nextOffset: null });
      }
      if (url.pathname === "/api/breweries" && method === "POST") {
        return jsonResponse(SAMPLE_BREWERY_DETAIL, 201);
      }
      if (url.pathname === "/api/brewery-invites/accept" && method === "POST") {
        return jsonResponse({
          ...SAMPLE_BREWERY_DETAIL,
          id: BREWERY_B_ID,
          name: "Eastside Collective",
          role: "brewer",
        });
      }
      return jsonResponse({ error: { code: "not_found", message: "Not found" } }, 404);
    }) as unknown as typeof fetch;

    const onCreated = vi.fn();
    const onAccepted = vi.fn();
    const onSelect = vi.fn();

    renderWithProviders(
      <BreweryHub
        serverUrl={SERVER_URL}
        authToken="tok"
        currentUserId={USER_OWNER}
        breweries={[SAMPLE_BREWERY_DETAIL]}
        activeBreweryId={BREWERY_A_ID}
        onSelectWorkspace={onSelect}
        onCreatedBrewery={onCreated}
        onAcceptedInvite={onAccepted}
        customFetch={customFetch}
      />,
      "us",
    );

    // Brewery inventory displays with OwnerBadge and US lb conversion (10 kg -> 22.05 lb)
    await waitFor(() => {
      expect(screen.getByTestId(`inventory-preview-item-${breweryInventory.id}`)).toBeTruthy();
    });
    expect(screen.getByTestId(`inventory-owner-badge-${breweryInventory.id}`).textContent).toBe(
      "Brewery: Northside Brew Club",
    );
    expect(screen.getByText(/22\.05 lb/)).toBeTruthy();

    // Pending invite shows up and can be accepted
    await waitFor(() => {
      expect(screen.getByTestId(`my-invite-${pendingInvite.id}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`accept-invite-${pendingInvite.id}`));
    await waitFor(() => {
      expect(onAccepted).toHaveBeenCalledTimes(1);
    });
    expect(
      requests.some(
        (r) =>
          r.url === "/api/brewery-invites/accept" &&
          (r.body as { id?: string })?.id === pendingInvite.id,
      ),
    ).toBe(true);

    // Join with one-time code
    fireEvent.change(screen.getByTestId("join-invite-code-input"), {
      target: { value: "secret-code-123" },
    });
    fireEvent.click(screen.getByTestId("join-invite-code-submit"));
    await waitFor(() => {
      expect(
        requests.some(
          (r) =>
            r.url === "/api/brewery-invites/accept" &&
            (r.body as { code?: string })?.code === "secret-code-123",
        ),
      ).toBe(true);
    });

    // Create a brewery
    fireEvent.change(screen.getByTestId("create-brewery-name-input"), {
      target: { value: "Northside Brew Club" },
    });
    fireEvent.change(screen.getByTestId("create-brewery-city-input"), {
      target: { value: "Portland" },
    });
    fireEvent.change(screen.getByTestId("create-brewery-state-input"), {
      target: { value: "OR" },
    });
    fireEvent.click(screen.getByTestId("create-brewery-submit"));
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });
    expect(
      requests.some(
        (r) =>
          r.url === "/api/breweries" &&
          r.method === "POST" &&
          (r.body as { name?: string; city?: string; state?: string })?.city === "Portland",
      ),
    ).toBe(true);
  });
});

describe("BreweryDetailView role controls and management actions", () => {
  it("shows owner controls, creates a one-time invite code, changes role, and transfers ownership", async () => {
    const requests: { method: string; url: string; body?: unknown }[] = [];
    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      const method = req.method;
      const bodyText = method !== "GET" && method !== "DELETE" ? await req.text() : "";
      const parsedBody = bodyText ? JSON.parse(bodyText) : undefined;
      requests.push({ method, url: url.pathname, body: parsedBody });

      if (url.pathname === `/api/breweries/${BREWERY_A_ID}/invites` && method === "GET") {
        return jsonResponse({ items: [] });
      }
      if (url.pathname === `/api/breweries/${BREWERY_A_ID}/invites` && method === "POST") {
        return jsonResponse(
          {
            id: "77777777-7777-7777-8777-777777777777",
            brewery: { id: BREWERY_A_ID, name: "Northside Brew Club" },
            role: "member",
            email: null,
            code: "ONE-TIME-CODE-XYZ",
            createdAt: "2026-11-10T10:00:00Z",
            expiresAt: "2026-11-17T10:00:00Z",
          },
          201,
        );
      }
      if (
        url.pathname === `/api/breweries/${BREWERY_A_ID}/members/${USER_MEMBER}/role` &&
        method === "PUT"
      ) {
        return jsonResponse({
          ...SAMPLE_BREWERY_DETAIL,
          members: SAMPLE_BREWERY_DETAIL.members.map((m) =>
            m.userId === USER_MEMBER ? { ...m, role: "brewer" } : m,
          ),
        });
      }
      if (url.pathname === `/api/breweries/${BREWERY_A_ID}/transfer` && method === "POST") {
        return jsonResponse({
          ...SAMPLE_BREWERY_DETAIL,
          role: "brewer",
          members: SAMPLE_BREWERY_DETAIL.members.map((m) =>
            m.userId === USER_BREWER
              ? { ...m, role: "owner" }
              : m.userId === USER_OWNER
                ? { ...m, role: "brewer" }
                : m,
          ),
        });
      }
      if (url.pathname === "/api/inventory" && method === "GET") {
        return jsonResponse({ items: [], nextOffset: null });
      }
      return jsonResponse({ error: { code: "not_found", message: "Not found" } }, 404);
    }) as unknown as typeof fetch;

    renderWithProviders(
      <BreweryDetailView
        serverUrl={SERVER_URL}
        authToken="tok"
        currentUserId={USER_OWNER}
        detail={SAMPLE_BREWERY_DETAIL}
        customFetch={customFetch}
      />,
    );

    // Owner sees invites, settings, and sole-owner leave protection
    expect(screen.getByTestId("brewery-invites-section")).toBeTruthy();
    expect(screen.getByTestId("brewery-settings-section")).toBeTruthy();
    expect(screen.getByTestId("leave-blocked-sole-owner")).toBeTruthy();
    expect(screen.queryByTestId("leave-brewery-button")).toBeNull();

    // Create a one-time invite code and verify code is shown
    fireEvent.click(screen.getByTestId("create-brewery-invite-button"));
    await waitFor(() => {
      expect(screen.getByTestId("brewery-invite-code-value").textContent).toBe("ONE-TIME-CODE-XYZ");
    });

    // Change Cara Member's role to Brewer
    const caraRow = screen.getByTestId(`owner-controls-${USER_MEMBER}`);
    const brewerTabs = caraRow.querySelectorAll('[role="tab"]');
    const brewerTab = Array.from(brewerTabs).find((el) => el.textContent === "Brewer");
    expect(brewerTab).toBeTruthy();
    fireEvent.click(brewerTab as Element);
    await waitFor(() => {
      expect(
        requests.some(
          (r) =>
            r.url === `/api/breweries/${BREWERY_A_ID}/members/${USER_MEMBER}/role` &&
            r.method === "PUT" &&
            (r.body as { role?: string })?.role === "brewer",
        ),
      ).toBe(true);
    });

    // Transfer ownership to Bob Brewer
    fireEvent.click(screen.getByTestId(`transfer-ownership-${USER_BREWER}`));
    fireEvent.click(screen.getByTestId(`confirm-transfer-${USER_BREWER}`));
    await waitFor(() => {
      expect(
        requests.some(
          (r) =>
            r.url === `/api/breweries/${BREWERY_A_ID}/transfer` &&
            r.method === "POST" &&
            (r.body as { userId?: string })?.userId === USER_BREWER,
        ),
      ).toBe(true);
    });
  });

  it("hides owner controls for Brewer, Member, and Viewer roles while allowing Leave", async () => {
    const onLeft = vi.fn();
    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/inventory") {
        return jsonResponse({ items: [], nextOffset: null });
      }
      if (
        url.pathname === `/api/breweries/${BREWERY_A_ID}/members/${USER_MEMBER}` &&
        req.method === "DELETE"
      ) {
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ error: { code: "forbidden", message: "Forbidden" } }, 403);
    }) as unknown as typeof fetch;

    renderWithProviders(
      <BreweryDetailView
        serverUrl={SERVER_URL}
        authToken="tok"
        currentUserId={USER_MEMBER}
        detail={{ ...SAMPLE_BREWERY_DETAIL, role: "member" }}
        onLeftOrDeleted={onLeft}
        customFetch={customFetch}
      />,
    );

    expect(screen.queryByTestId("brewery-invites-section")).toBeNull();
    expect(screen.queryByTestId("brewery-settings-section")).toBeNull();
    expect(screen.queryByTestId(`transfer-ownership-${USER_OWNER}`)).toBeNull();
    expect(screen.queryByTestId(`remove-member-${USER_OWNER}`)).toBeNull();

    // Member can leave the brewery
    fireEvent.click(screen.getByTestId("leave-brewery-button"));
    fireEvent.click(screen.getByTestId("confirm-leave-brewery-button"));
    await waitFor(() => {
      expect(onLeft).toHaveBeenCalledTimes(1);
    });
  });
});

describe("role-based UI gating on Recipes and Batches", () => {
  it("lets Brewer save recipe versions while hiding Delete and Sharing management", async () => {
    const customFetch = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;

    renderWithProviders(
      <RecipeBuilder
        serverUrl={SERVER_URL}
        authToken="tok"
        recipe={SAMPLE_RECIPE}
        canEdit={true}
        canDelete={false}
        canShare={false}
        onSaveVersion={async () => {}}
        onDelete={async () => {}}
        onFork={async () => {}}
        customFetch={customFetch}
      />,
    );

    expect(screen.getByTestId("recipe-save-button")).toBeTruthy();
    expect(screen.getByTestId("recipe-fork-button")).toBeTruthy();
    expect(screen.queryByTestId("recipe-delete-button")).toBeNull();
    expect(screen.queryByTestId("save-visibility-button")).toBeNull();
    expect(screen.queryByTestId("add-share-button")).toBeNull();
  });

  it("hides Save, Delete, and Sharing on RecipeBuilder for Member and Viewer", () => {
    const customFetch = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;

    renderWithProviders(
      <RecipeBuilder
        serverUrl={SERVER_URL}
        authToken="tok"
        recipe={SAMPLE_RECIPE}
        canEdit={false}
        canDelete={false}
        canShare={false}
        onSaveVersion={async () => {}}
        onDelete={async () => {}}
        onFork={async () => {}}
        customFetch={customFetch}
      />,
    );

    expect(screen.queryByTestId("recipe-save-button")).toBeNull();
    expect(screen.queryByTestId("recipe-delete-button")).toBeNull();
    expect(screen.queryByTestId("save-visibility-button")).toBeNull();
    expect(screen.getByTestId("recipe-fork-button")).toBeTruthy();
  });

  it("lets Member contribute readings and own notes without editing others, and hides forms for Viewer", () => {
    const readings: Reading[] = [
      {
        id: "r-1",
        batchId: "b-1",
        takenAt: "2026-11-05T10:00:00Z",
        gravitySg: 1.05,
        temperatureC: 20,
        ph: null,
        brix: null,
        titratableAcidityGPerL: null,
        freeSo2MgPerL: null,
        source: "manual",
        note: "OG",
        createdAt: "2026-11-05T10:00:00Z",
      },
    ];
    const notes: Note[] = [
      {
        id: "n-mine",
        uri: `${SERVER_URL}/notes/n-mine`,
        kind: "general",
        body: "Member note",
        recipeId: null,
        batchId: "b-1",
        scores: null,
        visibility: "private",
        owner: { type: "user", id: USER_MEMBER },
        createdAt: "2026-11-05T10:00:00Z",
        updatedAt: "2026-11-05T10:00:00Z",
      },
      {
        id: "n-brewery",
        uri: `${SERVER_URL}/notes/n-brewery`,
        kind: "general",
        body: "Brewery note",
        recipeId: null,
        batchId: "b-1",
        scores: null,
        visibility: "private",
        owner: { type: "brewery", id: BREWERY_A_ID },
        createdAt: "2026-11-05T11:00:00Z",
        updatedAt: "2026-11-05T11:00:00Z",
      },
    ];

    // Member: canContribute=true, canEdit=false
    const { unmount } = renderWithProviders(
      <>
        <ReadingsSection
          beverage="beer"
          readings={readings}
          canEdit={false}
          canContribute={true}
          onAddReading={async () => {}}
          onUpdateReading={async () => {}}
          onDeleteReading={async () => {}}
        />
        <BatchNotesSection
          batchId="b-1"
          notes={notes}
          canEdit={false}
          canContribute={true}
          canDeleteNote={(n) => n.owner.type === "user" && n.owner.id === USER_MEMBER}
          onCreateNote={async () => {}}
          onDeleteNote={async () => {}}
        />
      </>,
    );

    expect(screen.getByTestId("reading-submit-button")).toBeTruthy();
    expect(screen.queryByTestId("reading-edit-0")).toBeNull();
    expect(screen.queryByTestId("reading-delete-0")).toBeNull();
    expect(screen.getByTestId("note-submit-button")).toBeTruthy();
    expect(screen.getByTestId("note-delete-0")).toBeTruthy();
    expect(screen.queryByTestId("note-delete-1")).toBeNull();

    unmount();

    // Viewer: canContribute=false, canEdit=false
    renderWithProviders(
      <>
        <ReadingsSection
          beverage="beer"
          readings={readings}
          canEdit={false}
          canContribute={false}
          onAddReading={async () => {}}
          onUpdateReading={async () => {}}
          onDeleteReading={async () => {}}
        />
        <BatchNotesSection
          batchId="b-1"
          notes={notes}
          canEdit={false}
          canContribute={false}
          canDeleteNote={() => false}
          onCreateNote={async () => {}}
          onDeleteNote={async () => {}}
        />
      </>,
    );

    expect(screen.queryByTestId("reading-submit-button")).toBeNull();
    expect(screen.queryByTestId("note-submit-button")).toBeNull();
    expect(screen.queryByTestId("note-delete-0")).toBeNull();
  });

  it("renders OwnerPickerCard and MoveToBreweryBar for writable breweries", async () => {
    const onChange = vi.fn();
    const onMove = vi.fn(async () => {});
    const writable: Brewery[] = [SAMPLE_BREWERY_DETAIL];

    render(
      <>
        <OwnerPickerCard
          writableBreweries={writable}
          selectedBreweryId={null}
          onChangeBreweryId={onChange}
        />
        <MoveToBreweryBar
          itemLabel="recipe"
          writableBreweries={writable}
          moving={false}
          onMove={onMove}
        />
      </>,
    );

    fireEvent.click(screen.getByText("Northside Brew Club"));
    expect(onChange).toHaveBeenCalledWith(BREWERY_A_ID);

    fireEvent.click(screen.getByTestId("move-to-brewery-open"));
    fireEvent.click(screen.getByTestId("move-to-brewery-confirm"));
    await waitFor(() => {
      expect(onMove).toHaveBeenCalledWith(BREWERY_A_ID);
    });
  });

  it("hides MoveToBreweryBar when user has no writable breweries", () => {
    render(
      <MoveToBreweryBar
        itemLabel="batch"
        writableBreweries={[]}
        moving={false}
        onMove={async () => {}}
      />,
    );
    expect(screen.queryByTestId("move-to-brewery-open")).toBeNull();
  });

  it("persists workspace switch in BreweryProvider and resets when membership disappears", async () => {
    const store = new Map<string, string>();
    const memStorage: KeyValueStorage = {
      async getItem(k) {
        return store.get(k) ?? null;
      },
      async setItem(k, v) {
        store.set(k, v);
      },
      async removeItem(k) {
        store.delete(k);
      },
    };

    let currentBreweries: Brewery[] = [SAMPLE_BREWERY_DETAIL];
    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/me") {
        return jsonResponse({
          id: USER_VIEWER,
          uri: `${SERVER_URL}/users/${USER_VIEWER}`,
          email: "viewer@brew.test",
          displayName: "Val Viewer",
          isAdmin: false,
          units: "us",
        });
      }
      if (url.pathname === "/api/breweries") {
        return jsonResponse({ items: currentBreweries });
      }
      if (url.pathname === "/api/brewery-invites") {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({ error: { code: "not_found", message: "Not found" } }, 404);
    }) as unknown as typeof fetch;

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ServerProvider storage={memStorage} initialServerUrl={SERVER_URL}>
          <BreweryProvider storage={memStorage} customFetch={customFetch}>
            <BreweryProbe />
          </BreweryProvider>
        </ServerProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-count").textContent).toBe("1");
    });
    expect(screen.getByTestId("probe-active").textContent).toBe("Me");

    fireEvent.click(screen.getByTestId("probe-select"));
    await waitFor(() => {
      expect(screen.getByTestId("probe-active").textContent).toBe("Northside Brew Club");
    });
    expect([...store.values()]).toContain(BREWERY_A_ID);

    // Simulate leaving / losing membership -> provider auto-resets back to Me
    currentBreweries = [];
    await qc.invalidateQueries({ queryKey: ["breweries", SERVER_URL] });
    rerender(
      <QueryClientProvider client={qc}>
        <ServerProvider storage={memStorage} initialServerUrl={SERVER_URL}>
          <BreweryProvider storage={memStorage} customFetch={customFetch}>
            <BreweryProbe />
          </BreweryProvider>
        </ServerProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("probe-active").textContent).toBe("Me");
    });
  });
});
