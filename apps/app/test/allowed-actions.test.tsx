// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCurrentUser, useLogin, useLogout, useSyncCallerCache } from "../src/api/auth";
import type { BatchDetail, Reading } from "../src/api/batches";
import type { RecipeDetail } from "../src/api/recipes";
import { RecipeBuilder } from "../src/components/recipes/RecipeBuilder";
import { BreweryProvider } from "../src/state/brewery";
import { ServerProvider } from "../src/state/server";
import type { KeyValueStorage } from "../src/state/storage";
import { UnitsProvider } from "../src/state/units";

const mockRouteState = {
  pathname: "/recipes/rec-1",
  params: { id: "rec-1" } as Record<string, string>,
  push: vi.fn(),
  replace: vi.fn(),
};

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: mockRouteState.push, replace: mockRouteState.replace }),
  usePathname: () => mockRouteState.pathname,
  useLocalSearchParams: () => mockRouteState.params,
}));

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children, style }: { children?: ReactNode; style?: unknown }) => (
    <View style={style as never}>{children}</View>
  ),
}));

import BatchDetailScreen from "../app/batches/[id]";
import RecipeDetailScreen from "../app/recipes/[id]";

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  mockRouteState.push.mockReset();
  mockRouteState.replace.mockReset();
});

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

const SERVER_URL = "https://brew.example.test";
const OWNER_ID = "01950000-0000-7000-8000-000000000001";
const RECIPIENT_ID = "01950000-0000-7000-8000-000000000002";
const RECIPE_ID = "01950000-0000-7000-8000-000000000101";
const BATCH_ID = "01950000-0000-7000-8000-000000000201";

const RECIPIENT_USER = {
  id: RECIPIENT_ID,
  uri: `${SERVER_URL}/users/${RECIPIENT_ID}`,
  email: "friend@brew.test",
  displayName: "Shared Friend",
  isAdmin: false,
  units: "us" as const,
};

function makeRecipeDetail(can: RecipeDetail["can"]): RecipeDetail {
  return {
    id: RECIPE_ID,
    uri: `${SERVER_URL}/recipes/${RECIPE_ID}`,
    name: "Shared Cascade Pale",
    beverage: "beer",
    visibility: "private",
    owner: { type: "user", id: OWNER_ID },
    credit: null,
    forkedFrom: null,
    publicSharingBlocked: false,
    latestVersion: 1,
    createdAt: "2026-11-20T10:00:00Z",
    updatedAt: "2026-11-20T10:00:00Z",
    can,
    version: {
      id: "01950000-0000-7000-8000-000000000102",
      version: 1,
      name: "Shared Cascade Pale",
      beverage: "beer",
      styleId: null,
      batchSizeL: 18.927,
      equipmentProfileId: null,
      content: {
        schemaVersion: 1,
        efficiencyPct: 72,
        boilTimeMin: 60,
        fermentables: [
          {
            name: "Pale Malt (2 Row) US",
            kind: "grain",
            amountKg: 4.5,
            use: "mash",
            potentialSg: 1.036,
            colorEbc: 4,
          },
        ],
        hops: [],
        yeasts: [],
        miscs: [],
        mash: [],
        fermentation: [],
      },
      createdAt: "2026-11-20T10:00:00Z",
      stats: null,
      statsError: null,
      styleFit: null,
    },
  };
}

function makeBatchDetail(can: BatchDetail["can"]): BatchDetail {
  return {
    id: BATCH_ID,
    uri: `${SERVER_URL}/batches/${BATCH_ID}`,
    name: "Shared Pale #7",
    beverage: "beer",
    status: "planned",
    batchSizeL: 18.927,
    equipmentProfileId: null,
    brewedAt: null,
    completedAt: null,
    visibility: "private",
    owner: { type: "user", id: OWNER_ID },
    recipe: {
      id: RECIPE_ID,
      version: 1,
      versionId: "01950000-0000-7000-8000-000000000102",
    },
    createdAt: "2026-11-20T10:00:00Z",
    updatedAt: "2026-11-20T10:00:00Z",
    statusHistory: [{ status: "planned", changedAt: "2026-11-20T10:00:00Z" }],
    allowedStatuses: ["brewing"],
    can,
  };
}

function renderScreen(ui: ReactNode, queryClient?: QueryClient) {
  const qc =
    queryClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  return {
    queryClient: qc,
    ...render(
      <QueryClientProvider client={qc}>
        <UnitsProvider storage={noopStorage} initialUnitSystem="us">
          <ServerProvider storage={noopStorage} initialServerUrl={SERVER_URL}>
            <BreweryProvider storage={noopStorage}>{ui}</BreweryProvider>
          </ServerProvider>
        </UnitsProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("RecipeDetailScreen allowed actions (#90)", () => {
  it("shows editing controls for a non-owner with an edit share while hiding delete, share, and move", async () => {
    mockRouteState.pathname = `/recipes/${RECIPE_ID}`;
    mockRouteState.params = { id: RECIPE_ID };

    const savedVersions: Record<string, unknown>[] = [];
    const detail = makeRecipeDetail({
      contribute: true,
      edit: true,
      delete: false,
      share: false,
    });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/me") return jsonResponse(RECIPIENT_USER);
      if (url.pathname === "/api/breweries") return jsonResponse({ items: [] });
      if (url.pathname === "/api/brewery-invites") return jsonResponse({ items: [] });
      if (url.pathname === `/api/recipes/${RECIPE_ID}` && req.method === "GET") {
        return jsonResponse(detail);
      }
      if (url.pathname === `/api/recipes/${RECIPE_ID}/versions` && req.method === "GET") {
        return jsonResponse([
          {
            id: detail.version.id,
            version: 1,
            name: detail.name,
            createdAt: detail.createdAt,
          },
        ]);
      }
      if (url.pathname === `/api/recipes/${RECIPE_ID}/versions` && req.method === "POST") {
        const body = JSON.parse(await req.clone().text()) as Record<string, unknown>;
        savedVersions.push(body);
        return jsonResponse({ ...detail.version, version: 2, name: body.name }, 201);
      }
      if (url.pathname === "/api/equipment-profiles") return jsonResponse([]);
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderScreen(<RecipeDetailScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("recipe-save-button")).toBeTruthy();
    });

    // Edit share grants saving new versions, NOT delete, share, or move
    expect(screen.queryByTestId("recipe-delete-button")).toBeNull();
    expect(screen.queryByTestId("recipe-share-button")).toBeNull();
    expect(screen.queryByTestId("move-recipe-button")).toBeNull();

    fireEvent.change(screen.getByTestId("recipe-name-input"), {
      target: { value: "Shared Cascade Pale v2" },
    });
    fireEvent.click(screen.getByTestId("recipe-save-button"));

    await waitFor(() => {
      expect(savedVersions).toHaveLength(1);
    });
    expect(savedVersions[0]?.name).toBe("Shared Cascade Pale v2");
  });

  it("renders read-only controls for a read share and defaults RecipeBuilder permissions from recipe.can", async () => {
    mockRouteState.pathname = `/recipes/${RECIPE_ID}`;
    mockRouteState.params = { id: RECIPE_ID };

    const readOnlyDetail = makeRecipeDetail({
      contribute: false,
      edit: false,
      delete: false,
      share: false,
    });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/me") return jsonResponse(RECIPIENT_USER);
      if (url.pathname === "/api/breweries") return jsonResponse({ items: [] });
      if (url.pathname === "/api/brewery-invites") return jsonResponse({ items: [] });
      if (url.pathname === `/api/recipes/${RECIPE_ID}`) return jsonResponse(readOnlyDetail);
      if (url.pathname === `/api/recipes/${RECIPE_ID}/versions`) return jsonResponse([]);
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderScreen(<RecipeDetailScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("recipe-owner-badge")).toBeTruthy();
    });
    expect(screen.queryByTestId("recipe-save-button")).toBeNull();
    expect(screen.queryByTestId("recipe-delete-button")).toBeNull();
    expect(screen.queryByTestId("recipe-share-button")).toBeNull();

    // Direct RecipeBuilder fallback also reads recipe.can when explicit flags aren't passed
    cleanup();
    const editShareDetail = makeRecipeDetail({
      contribute: true,
      edit: true,
      delete: false,
      share: false,
    });
    const customFetch = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;
    renderScreen(
      <RecipeBuilder
        serverUrl={SERVER_URL}
        authToken="tok"
        recipe={editShareDetail}
        onSaveVersion={async () => {}}
        onDelete={async () => {}}
        customFetch={customFetch}
      />,
    );
    expect(screen.getByTestId("recipe-save-button")).toBeTruthy();
    expect(screen.queryByTestId("recipe-delete-button")).toBeNull();
    expect(screen.queryByTestId("share-panel-recipe")).toBeNull();
    expect(screen.queryByTestId("save-visibility-button")).toBeNull();
  });
});

describe("BatchDetailScreen allowed actions (#90)", () => {
  const sampleReadings: Reading[] = [
    {
      id: "01950000-0000-7000-8000-000000000301",
      batchId: BATCH_ID,
      takenAt: "2026-11-21T10:00:00Z",
      gravitySg: 1.052,
      temperatureC: 20,
      ph: null,
      brix: null,
      titratableAcidityGPerL: null,
      freeSo2MgPerL: null,
      source: "manual",
      note: "OG",
      createdAt: "2026-11-21T10:00:00Z",
    },
  ];

  it("enables status moves, reading edits, reminders, and notes for an edit share while hiding delete, share, move, and connect device", async () => {
    mockRouteState.pathname = `/batches/${BATCH_ID}`;
    mockRouteState.params = { id: BATCH_ID };

    let currentBatch = makeBatchDetail({
      contribute: true,
      edit: true,
      delete: false,
      share: false,
    });
    let statusMoveCalls = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/me") return jsonResponse(RECIPIENT_USER);
      if (url.pathname === "/api/breweries") return jsonResponse({ items: [] });
      if (url.pathname === "/api/brewery-invites") return jsonResponse({ items: [] });
      if (url.pathname === `/api/batches/${BATCH_ID}` && req.method === "GET") {
        return jsonResponse(currentBatch);
      }
      if (url.pathname === `/api/batches/${BATCH_ID}/status` && req.method === "POST") {
        statusMoveCalls += 1;
        currentBatch = {
          ...currentBatch,
          status: "brewing",
          allowedStatuses: ["fermenting", "planned"],
        };
        return jsonResponse({
          batch: currentBatch,
          addedReminders: [],
          scheduleError: null,
          inventory: null,
        });
      }
      if (url.pathname === `/api/batches/${BATCH_ID}/readings`) return jsonResponse(sampleReadings);
      if (url.pathname === `/api/batches/${BATCH_ID}/reminders`) return jsonResponse([]);
      if (url.pathname === `/api/batches/${BATCH_ID}/reservations`) {
        return jsonResponse({ items: [] });
      }
      if (url.pathname === `/api/batches/${BATCH_ID}/stats`) {
        return jsonResponse({ stats: null, statsError: null, alphaAcidFromInventory: [] });
      }
      if (url.pathname === "/api/notes") return jsonResponse({ items: [], nextOffset: null });
      if (url.pathname.startsWith(`/api/recipes/${RECIPE_ID}/versions/`)) {
        return jsonResponse(makeRecipeDetail(currentBatch.can).version);
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderScreen(<BatchDetailScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("status-step-brewing")).toBeTruthy();
    });

    // Owner/share-only actions stay hidden for an edit share
    expect(screen.queryByTestId("batch-delete-button")).toBeNull();
    expect(screen.queryByTestId("batch-share-button")).toBeNull();
    expect(screen.queryByTestId("move-batch-button")).toBeNull();
    expect(screen.queryByTestId("batch-connect-device-button")).toBeNull();

    // Readings: can log AND edit/delete readings
    expect(screen.getByTestId("reading-submit-button")).toBeTruthy();
    expect(screen.getByTestId("reading-edit-0")).toBeTruthy();
    expect(screen.getByTestId("reading-delete-0")).toBeTruthy();

    // Status transition works via can.edit
    fireEvent.click(screen.getByTestId("status-step-brewing"));
    await waitFor(() => {
      expect(statusMoveCalls).toBe(1);
    });

    // Reminders tab exposes reminder form via can.edit
    fireEvent.click(screen.getByRole("tab", { name: "Batch reminders" }));
    expect(screen.getByTestId("reminder-submit-button")).toBeTruthy();

    // Notes tab exposes composer via can.contribute
    fireEvent.click(screen.getByRole("tab", { name: "Batch notes and tasting scores" }));
    expect(screen.getByTestId("note-submit-button")).toBeTruthy();
  });

  it("gates batch screen strictly for contribute-only vs read-only can flags", async () => {
    mockRouteState.pathname = `/batches/${BATCH_ID}`;
    mockRouteState.params = { id: BATCH_ID };

    const memberBatch = makeBatchDetail({
      contribute: true,
      edit: false,
      delete: false,
      share: false,
    });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/me") return jsonResponse(RECIPIENT_USER);
      if (url.pathname === "/api/breweries") return jsonResponse({ items: [] });
      if (url.pathname === "/api/brewery-invites") return jsonResponse({ items: [] });
      if (url.pathname === `/api/batches/${BATCH_ID}`) return jsonResponse(memberBatch);
      if (url.pathname === `/api/batches/${BATCH_ID}/readings`) return jsonResponse(sampleReadings);
      if (url.pathname === `/api/batches/${BATCH_ID}/reminders`) return jsonResponse([]);
      if (url.pathname === `/api/batches/${BATCH_ID}/reservations`) {
        return jsonResponse({ items: [] });
      }
      if (url.pathname === `/api/batches/${BATCH_ID}/stats`) {
        return jsonResponse({ stats: null, statsError: null, alphaAcidFromInventory: [] });
      }
      if (url.pathname === "/api/notes") return jsonResponse({ items: [], nextOffset: null });
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    renderScreen(<BatchDetailScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("reading-submit-button")).toBeTruthy();
    });
    // Contribute-only can log readings & notes, but cannot edit/delete readings or add reminders
    expect(screen.queryByTestId("reading-edit-0")).toBeNull();
    expect(screen.queryByTestId("reading-delete-0")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Batch reminders" }));
    expect(screen.queryByTestId("reminder-submit-button")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Batch notes and tasting scores" }));
    expect(screen.getByTestId("note-submit-button")).toBeTruthy();
  });
});

function AuthHarness({ customFetch }: { customFetch: typeof fetch }) {
  const login = useLogin(SERVER_URL, async () => {}, customFetch);
  const logout = useLogout(SERVER_URL, "tok", async () => {}, customFetch);
  return (
    <View>
      <Pressable
        testID="harness-login"
        onPress={() => void login.mutateAsync({ email: "friend@brew.test", password: "secret" })}
      >
        <Text>Login</Text>
      </Pressable>
      <Pressable testID="harness-logout" onPress={() => void logout.mutateAsync()}>
        <Text>Logout</Text>
      </Pressable>
    </View>
  );
}

function SyncBridge() {
  const currentUser = useCurrentUser(SERVER_URL, null);
  useSyncCallerCache(SERVER_URL, currentUser.data?.id ?? null, currentUser.isPending);
  return null;
}

describe("Caller-scoped detail cache clearing across sign-in changes (#90)", () => {
  it("drops cached recipe-detail and batch-detail on logout and login while keeping public catalog cache", async () => {
    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/me") return jsonResponse(RECIPIENT_USER);
      if (url.pathname === "/api/breweries") return jsonResponse({ items: [] });
      if (url.pathname === "/api/brewery-invites") return jsonResponse({ items: [] });
      if (url.pathname === "/api/auth/logout") return new Response(null, { status: 204 });
      if (url.pathname === "/api/auth/login") {
        return jsonResponse({ user: RECIPIENT_USER, token: "new-tok" });
      }
      return jsonResponse({});
    }) as unknown as typeof fetch;
    globalThis.fetch = customFetch;

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ownerRecipe = makeRecipeDetail({
      contribute: true,
      edit: true,
      delete: true,
      share: true,
    });
    const ownerBatch = makeBatchDetail({
      contribute: true,
      edit: true,
      delete: true,
      share: true,
    });

    const seedCaches = () => {
      queryClient.setQueryData(["recipe-detail", SERVER_URL, RECIPE_ID], ownerRecipe);
      queryClient.setQueryData(["batch-detail", SERVER_URL, BATCH_ID], ownerBatch);
      queryClient.setQueryData(["catalog-item", SERVER_URL, "hops", "hop-columbus"], {
        id: "hop-columbus",
      });
    };

    renderScreen(<AuthHarness customFetch={customFetch} />, queryClient);

    // 1. Logout removes caller-scoped detail caches (and leaves public catalog intact)
    seedCaches();
    fireEvent.click(screen.getByTestId("harness-logout"));
    await waitFor(() => {
      expect(queryClient.getQueryData(["recipe-detail", SERVER_URL, RECIPE_ID])).toBeUndefined();
      expect(queryClient.getQueryData(["batch-detail", SERVER_URL, BATCH_ID])).toBeUndefined();
    });
    expect(queryClient.getQueryData(["catalog-item", SERVER_URL, "hops", "hop-columbus"])).toEqual({
      id: "hop-columbus",
    });

    // 2. Login as a different user removes any previously cached detail entries with stale `can`
    seedCaches();
    fireEvent.click(screen.getByTestId("harness-login"));
    await waitFor(() => {
      expect(queryClient.getQueryData(["recipe-detail", SERVER_URL, RECIPE_ID])).toBeUndefined();
      expect(queryClient.getQueryData(["batch-detail", SERVER_URL, BATCH_ID])).toBeUndefined();
    });
    expect(queryClient.getQueryData(["catalog-item", SERVER_URL, "hops", "hop-columbus"])).toEqual({
      id: "hop-columbus",
    });
  });

  it("resets an active RecipeDetailScreen when the signed-in user changes via useSyncCallerCache", async () => {
    mockRouteState.pathname = `/recipes/${RECIPE_ID}`;
    mockRouteState.params = { id: RECIPE_ID };

    const OWNER_USER = {
      ...RECIPIENT_USER,
      id: OWNER_ID,
      email: "owner@brew.test",
      displayName: "Recipe Owner",
    };

    let activeCaller: "owner" | "recipient" = "owner";
    let recipeFetchCount = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/me") {
        return jsonResponse(activeCaller === "owner" ? OWNER_USER : RECIPIENT_USER);
      }
      if (url.pathname === "/api/breweries") return jsonResponse({ items: [] });
      if (url.pathname === "/api/brewery-invites") return jsonResponse({ items: [] });
      if (url.pathname === `/api/recipes/${RECIPE_ID}`) {
        recipeFetchCount += 1;
        return jsonResponse(
          makeRecipeDetail(
            activeCaller === "owner"
              ? { contribute: true, edit: true, delete: true, share: true }
              : { contribute: false, edit: false, delete: false, share: false },
          ),
        );
      }
      if (url.pathname === `/api/recipes/${RECIPE_ID}/versions`) return jsonResponse([]);
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    const { queryClient } = renderScreen(
      <>
        <SyncBridge />
        <RecipeDetailScreen />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("recipe-save-button")).toBeTruthy();
      expect(screen.getByTestId("recipe-delete-button")).toBeTruthy();
      expect(screen.getByTestId("recipe-share-button")).toBeTruthy();
    });
    expect(recipeFetchCount).toBe(1);

    // Simulate the session switching to a read-only recipient on the same server
    activeCaller = "recipient";
    queryClient.setQueryData(["auth-me", SERVER_URL], RECIPIENT_USER);

    await waitFor(() => {
      expect(recipeFetchCount).toBe(2);
      expect(screen.queryByTestId("recipe-save-button")).toBeNull();
      expect(screen.queryByTestId("recipe-delete-button")).toBeNull();
      expect(screen.queryByTestId("recipe-share-button")).toBeNull();
    });
  });
});
