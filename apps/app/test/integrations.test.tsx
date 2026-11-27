// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Batch, Reading } from "../src/api/batches";
import type { Brewery } from "../src/api/breweries";
import {
  type BrewfatherImport,
  type Device,
  extractDeviceToken,
  type Webhook,
} from "../src/api/integrations";
import { BrewfatherPanel } from "../src/components/integrations/BrewfatherPanel";
import { DevicesPanel } from "../src/components/integrations/DevicesPanel";
import { WebhooksPanel } from "../src/components/integrations/WebhooksPanel";
import { UnitToggle } from "../src/components/UnitToggle";
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

function renderWithProviders(
  ui: ReactNode,
  initialUnitSystem: "us" | "metric" = "us",
  opts: { strictMode?: boolean } = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const content = (
    <QueryClientProvider client={qc}>
      <UnitsProvider storage={noopStorage} initialUnitSystem={initialUnitSystem}>
        {ui}
      </UnitsProvider>
    </QueryClientProvider>
  );
  return {
    queryClient: qc,
    ...render(opts.strictMode ? <StrictMode>{content}</StrictMode> : content),
  };
}

const SERVER_URL = "https://brew.example.test";
const USER_ID = "01950000-0000-7000-8000-000000000001";
const BREWERY_OWNER_ID = "01950000-0000-7000-8000-000000000010";
const BREWERY_MEMBER_ID = "01950000-0000-7000-8000-000000000011";
const BATCH_PERSONAL_ID = "01950000-0000-7000-8000-000000000101";
const BATCH_CLUB_EDITABLE_ID = "01950000-0000-7000-8000-000000000102";
const BATCH_CLUB_MEMBER_ID = "01950000-0000-7000-8000-000000000103";

const BREWERY_OWNER: Brewery = {
  id: BREWERY_OWNER_ID,
  uri: `${SERVER_URL}/breweries/${BREWERY_OWNER_ID}`,
  name: "Northside Brew Club",
  description: null,
  city: "Portland",
  state: "OR",
  role: "owner",
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
};

const BREWERY_MEMBER: Brewery = {
  id: BREWERY_MEMBER_ID,
  uri: `${SERVER_URL}/breweries/${BREWERY_MEMBER_ID}`,
  name: "Southside Guild",
  description: null,
  city: "Eugene",
  state: "OR",
  role: "member",
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
};

function makeBatch(id: string, name: string, owner: Batch["owner"]): Batch {
  return {
    id,
    uri: `${SERVER_URL}/batches/${id}`,
    name,
    beverage: "beer",
    status: "fermenting",
    batchSizeL: 18.927,
    equipmentProfileId: null,
    brewedAt: "2026-11-20T12:00:00Z",
    completedAt: null,
    visibility: "private",
    owner,
    recipe: {
      id: "01950000-0000-7000-8000-000000000201",
      version: 1,
      versionId: "01950000-0000-7000-8000-000000000202",
    },
    createdAt: "2026-11-20T12:00:00Z",
    updatedAt: "2026-11-20T12:00:00Z",
  };
}

describe("Integrations helpers", () => {
  it("extracts device token from issued upload URL", () => {
    expect(
      extractDeviceToken(
        "https://brew.example.test/api/device-readings?token=bb_1234567890abcdef_TOKEN",
      ),
    ).toBe("bb_1234567890abcdef_TOKEN");
    expect(extractDeviceToken("not-a-url")).toBeNull();
  });
});

describe("DevicesPanel (P2-14)", () => {
  it("creates a Tilt device with color, shows copyable URL & token, displays incoming reading in user units, rotates and revokes", async () => {
    const batches: Batch[] = [
      makeBatch(BATCH_PERSONAL_ID, "Cascade Pale #1", { type: "user", id: USER_ID }),
      makeBatch(BATCH_CLUB_EDITABLE_ID, "Club IPA #2", {
        type: "brewery",
        id: BREWERY_OWNER_ID,
      }),
      makeBatch(BATCH_CLUB_MEMBER_ID, "Member-only Stout", {
        type: "brewery",
        id: BREWERY_MEMBER_ID,
      }),
    ];
    let devices: Device[] = [];
    const readingsByBatch = new Map<string, Reading[]>();
    const createdPayloads: Record<string, unknown>[] = [];
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/batches" && req.method === "GET") {
        return jsonResponse({ items: batches, nextOffset: null });
      }
      if (url.pathname === "/api/integrations/devices" && req.method === "GET") {
        return jsonResponse({ items: devices });
      }
      if (url.pathname === "/api/integrations/devices" && req.method === "POST") {
        const body = JSON.parse(await req.clone().text()) as Record<string, unknown>;
        createdPayloads.push(body);
        const created: Device = {
          id: "01950000-0000-7000-8000-000000000301",
          name: String(body.name),
          kind: body.kind as Device["kind"],
          batchId: String(body.batchId),
          tiltColor: (body.tiltColor as Device["tiltColor"]) ?? null,
          lastSeenAt: null,
        };
        devices = [...devices, created];
        return jsonResponse(
          {
            ...created,
            url: `${SERVER_URL}/api/device-readings?token=bb_initialSecretTokenValue12345678901234567890`,
          },
          201,
        );
      }
      if (
        url.pathname === "/api/integrations/devices/01950000-0000-7000-8000-000000000301/rotate" &&
        req.method === "POST"
      ) {
        const target = devices[0] as Device;
        return jsonResponse({
          ...target,
          url: `${SERVER_URL}/api/device-readings?token=bb_rotatedSecretTokenValue12345678901234567890`,
        });
      }
      if (
        url.pathname === "/api/integrations/devices/01950000-0000-7000-8000-000000000301" &&
        req.method === "DELETE"
      ) {
        devices = [];
        return new Response(null, { status: 204 });
      }
      const readingMatch = /^\/api\/batches\/([^/]+)\/readings$/.exec(url.pathname);
      if (readingMatch && req.method === "GET") {
        return jsonResponse(readingsByBatch.get(readingMatch[1] ?? "") ?? []);
      }
      return jsonResponse({ error: { code: "not_found", message: "Not found" } }, 404);
    }) as unknown as typeof fetch;

    renderWithProviders(
      <DevicesPanel
        serverUrl={SERVER_URL}
        authToken="tok"
        currentUserId={USER_ID}
        breweries={[BREWERY_OWNER, BREWERY_MEMBER]}
        customFetch={customFetch}
      />,
    );

    // Wait for batch picker; Member-only brewery batch must be excluded
    await waitFor(() => {
      expect(screen.getByTestId(`device-batch-option-${BATCH_PERSONAL_ID}`)).toBeTruthy();
    });
    expect(screen.getByTestId(`device-batch-option-${BATCH_CLUB_EDITABLE_ID}`)).toBeTruthy();
    expect(screen.queryByTestId(`device-batch-option-${BATCH_CLUB_MEMBER_ID}`)).toBeNull();

    // Pick Tilt kind, pink color, and personal batch
    fireEvent.click(screen.getByRole("tab", { name: "Tilt via TiltBridge or TiltPi" }));
    fireEvent.click(screen.getByTestId("tilt-color-pink"));
    fireEvent.change(screen.getByTestId("device-name-input"), {
      target: { value: "Pink Tilt #1" },
    });
    fireEvent.click(screen.getByTestId(`device-batch-option-${BATCH_PERSONAL_ID}`));
    fireEvent.click(screen.getByTestId("device-create-button"));

    // Verify issued URL and extracted token are both shown and copyable
    await waitFor(() => {
      expect(screen.getByTestId("issued-device-url").textContent).toContain(
        "bb_initialSecretTokenValue12345678901234567890",
      );
    });
    expect(screen.getByTestId("issued-device-token").textContent).toBe(
      "bb_initialSecretTokenValue12345678901234567890",
    );
    expect(createdPayloads[0]).toEqual({
      name: "Pink Tilt #1",
      kind: "tilt",
      batchId: BATCH_PERSONAL_ID,
      tiltColor: "pink",
    });

    fireEvent.click(screen.getByTestId("copy-device-url-button"));
    fireEvent.click(screen.getByTestId("copy-device-token-button"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        `${SERVER_URL}/api/device-readings?token=bb_initialSecretTokenValue12345678901234567890`,
      );
      expect(writeText).toHaveBeenCalledWith("bb_initialSecretTokenValue12345678901234567890");
    });

    // Initially waiting for reading
    expect(
      screen.getByTestId("device-status-01950000-0000-7000-8000-000000000301").textContent,
    ).toContain("Waiting for reading");

    // Simulate a device reading arriving on the server (20°C = 68.0°F in US units)
    devices = [
      {
        ...(devices[0] as Device),
        lastSeenAt: "2026-11-26T15:30:00Z",
      },
    ];
    readingsByBatch.set(BATCH_PERSONAL_ID, [
      {
        id: "01950000-0000-7000-8000-000000000401",
        batchId: BATCH_PERSONAL_ID,
        takenAt: "2026-11-26T15:30:00Z",
        gravitySg: 1.018,
        temperatureC: 20.0,
        ph: null,
        brix: null,
        titratableAcidityGPerL: null,
        freeSo2MgPerL: null,
        source: "device",
        note: null,
        createdAt: "2026-11-26T15:30:00Z",
      },
    ]);

    fireEvent.click(screen.getByTestId("devices-refresh-button"));

    await waitFor(() => {
      const readingBox = screen.getByTestId(
        "device-last-reading-01950000-0000-7000-8000-000000000301",
      );
      expect(readingBox.textContent).toContain("1.018 SG");
      expect(readingBox.textContent).toContain("68.0 °F");
    });
    expect(
      screen.getByTestId("device-status-01950000-0000-7000-8000-000000000301").textContent,
    ).toContain("Last seen");

    // Rotate token -> new token shown
    fireEvent.click(screen.getByTestId("device-rotate-01950000-0000-7000-8000-000000000301"));
    await waitFor(() => {
      expect(screen.getByTestId("issued-device-token").textContent).toBe(
        "bb_rotatedSecretTokenValue12345678901234567890",
      );
    });

    // Revoke device (2-step confirm)
    fireEvent.click(screen.getByTestId("device-revoke-01950000-0000-7000-8000-000000000301"));
    fireEvent.click(
      screen.getByTestId("device-confirm-revoke-01950000-0000-7000-8000-000000000301"),
    );
    await waitFor(() => {
      expect(screen.getByTestId("devices-empty")).toBeTruthy();
    });
  });

  it("omits tiltColor when switching from Tilt back to iSpindel", async () => {
    const batches = [makeBatch(BATCH_PERSONAL_ID, "House Bitter", { type: "user", id: USER_ID })];
    const payloads: Record<string, unknown>[] = [];
    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/batches")
        return jsonResponse({ items: batches, nextOffset: null });
      if (url.pathname === "/api/integrations/devices" && req.method === "GET") {
        return jsonResponse({ items: [] });
      }
      if (url.pathname === "/api/integrations/devices" && req.method === "POST") {
        const body = JSON.parse(await req.clone().text()) as Record<string, unknown>;
        payloads.push(body);
        return jsonResponse(
          {
            id: "01950000-0000-7000-8000-000000000302",
            name: body.name,
            kind: body.kind,
            batchId: body.batchId,
            tiltColor: null,
            lastSeenAt: null,
            url: `${SERVER_URL}/api/device-readings?token=bb_ispindelToken123456789012345678901234567`,
          },
          201,
        );
      }
      return jsonResponse({ items: [] });
    }) as unknown as typeof fetch;

    renderWithProviders(
      <DevicesPanel
        serverUrl={SERVER_URL}
        authToken="tok"
        currentUserId={USER_ID}
        breweries={[]}
        customFetch={customFetch}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId(`device-batch-option-${BATCH_PERSONAL_ID}`)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("tab", { name: "Tilt via TiltBridge or TiltPi" }));
    fireEvent.click(screen.getByTestId("tilt-color-blue"));
    fireEvent.click(screen.getByRole("tab", { name: "iSpindel hydrometer" }));
    fireEvent.change(screen.getByTestId("device-name-input"), {
      target: { value: "Fermenter iSpindel" },
    });
    fireEvent.click(screen.getByTestId("device-create-button"));

    await waitFor(() => {
      expect(payloads).toHaveLength(1);
    });
    expect(payloads[0]).toEqual({
      name: "Fermenter iSpindel",
      kind: "ispindel",
      batchId: BATCH_PERSONAL_ID,
    });
    expect("tiltColor" in (payloads[0] ?? {})).toBe(false);
  });

  it("allows switching away from initialBatchId before creating a device", async () => {
    const batches: Batch[] = [
      makeBatch(BATCH_PERSONAL_ID, "Cascade Pale #1", { type: "user", id: USER_ID }),
      makeBatch(BATCH_CLUB_EDITABLE_ID, "Club IPA #2", {
        type: "brewery",
        id: BREWERY_OWNER_ID,
      }),
    ];
    const payloads: Record<string, unknown>[] = [];
    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/batches")
        return jsonResponse({ items: batches, nextOffset: null });
      if (url.pathname === "/api/integrations/devices" && req.method === "GET") {
        return jsonResponse({ items: [] });
      }
      if (url.pathname === "/api/integrations/devices" && req.method === "POST") {
        const body = JSON.parse(await req.clone().text()) as Record<string, unknown>;
        payloads.push(body);
        return jsonResponse(
          {
            id: "01950000-0000-7000-8000-000000000303",
            name: body.name,
            kind: body.kind,
            batchId: body.batchId,
            tiltColor: null,
            lastSeenAt: null,
            url: `${SERVER_URL}/api/device-readings?token=bb_clubIpaToken12345678901234567890123456789`,
          },
          201,
        );
      }
      return jsonResponse({ items: [] });
    }) as unknown as typeof fetch;

    renderWithProviders(
      <DevicesPanel
        serverUrl={SERVER_URL}
        authToken="tok"
        currentUserId={USER_ID}
        breweries={[BREWERY_OWNER]}
        initialBatchId={BATCH_PERSONAL_ID}
        customFetch={customFetch}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId(`device-batch-option-${BATCH_CLUB_EDITABLE_ID}`)).toBeTruthy();
    });
    expect(
      screen.getByTestId(`device-batch-option-${BATCH_PERSONAL_ID}`).getAttribute("aria-checked"),
    ).toBe("true");

    // Switch from initialBatchId to the club batch and create the device
    fireEvent.click(screen.getByTestId(`device-batch-option-${BATCH_CLUB_EDITABLE_ID}`));
    expect(
      screen
        .getByTestId(`device-batch-option-${BATCH_CLUB_EDITABLE_ID}`)
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.change(screen.getByTestId("device-name-input"), {
      target: { value: "Club GravityMon" },
    });
    fireEvent.click(screen.getByTestId("device-create-button"));

    await waitFor(() => {
      expect(payloads).toHaveLength(1);
    });
    expect(payloads[0]).toEqual({
      name: "Club GravityMon",
      kind: "ispindel",
      batchId: BATCH_CLUB_EDITABLE_ID,
    });
  });
});

describe("WebhooksPanel (P2-14)", () => {
  it("creates a webhook with one-time signing key, sends test event, displays failing status, and deletes", async () => {
    const batches = [
      makeBatch(BATCH_PERSONAL_ID, "Cascade Pale #1", { type: "user", id: USER_ID }),
    ];
    let webhooks: Webhook[] = [
      {
        id: "01950000-0000-7000-8000-000000000501",
        name: "Broken Relay",
        url: "https://broken.example.test/hook",
        batchId: null,
        breweryId: null,
        lastDeliveredAt: null,
        failing: true,
      },
    ];
    let testCalls = 0;

    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/batches")
        return jsonResponse({ items: batches, nextOffset: null });
      if (url.pathname === "/api/integrations/webhooks" && req.method === "GET") {
        return jsonResponse({ items: webhooks });
      }
      if (url.pathname === "/api/integrations/webhooks" && req.method === "POST") {
        const body = JSON.parse(await req.clone().text()) as Record<string, unknown>;
        const created: Webhook = {
          id: "01950000-0000-7000-8000-000000000502",
          name: String(body.name),
          url: String(body.url),
          batchId: (body.batchId as string | undefined) ?? null,
          breweryId: (body.breweryId as string | undefined) ?? null,
          lastDeliveredAt: null,
          failing: false,
        };
        webhooks = [...webhooks, created];
        return jsonResponse({ ...created, signingKey: "bb_webhookSigningKeySecret" }, 201);
      }
      if (
        url.pathname === "/api/integrations/webhooks/01950000-0000-7000-8000-000000000502/test" &&
        req.method === "POST"
      ) {
        testCalls += 1;
        return jsonResponse({ queued: true }, 202);
      }
      if (
        url.pathname === "/api/integrations/webhooks/01950000-0000-7000-8000-000000000501" &&
        req.method === "DELETE"
      ) {
        webhooks = webhooks.filter((w) => w.id !== "01950000-0000-7000-8000-000000000501");
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ error: { code: "not_found", message: "Not found" } }, 404);
    }) as unknown as typeof fetch;

    renderWithProviders(
      <WebhooksPanel
        serverUrl={SERVER_URL}
        authToken="tok"
        currentUserId={USER_ID}
        activeBrewery={null}
        customFetch={customFetch}
      />,
    );

    // Failing webhook is prominently surfaced
    await waitFor(() => {
      expect(screen.getByTestId("webhooks-failing-summary")).toBeTruthy();
    });
    expect(
      screen.getByTestId("webhook-status-01950000-0000-7000-8000-000000000501").textContent,
    ).toBe("Failing");
    expect(
      screen.getByTestId("webhook-failure-banner-01950000-0000-7000-8000-000000000501"),
    ).toBeTruthy();

    // Add a new batch-scoped webhook
    fireEvent.change(screen.getByTestId("webhook-name-input"), {
      target: { value: "Discord Brew Alerts" },
    });
    fireEvent.change(screen.getByTestId("webhook-url-input"), {
      target: { value: "https://hooks.example.test/receive" },
    });
    fireEvent.click(screen.getByTestId(`webhook-batch-option-${BATCH_PERSONAL_ID}`));
    fireEvent.click(screen.getByTestId("webhook-create-button"));

    await waitFor(() => {
      expect(screen.getByTestId("issued-webhook-key").textContent).toBe(
        "bb_webhookSigningKeySecret",
      );
    });

    // Send a test delivery
    fireEvent.click(screen.getByTestId("webhook-test-01950000-0000-7000-8000-000000000502"));
    await waitFor(() => {
      expect(testCalls).toBe(1);
      expect(screen.getByTestId("webhook-notice").textContent).toContain("Test event queued");
    });

    // Delete the failing webhook -> failure summary disappears
    fireEvent.click(screen.getByTestId("webhook-delete-01950000-0000-7000-8000-000000000501"));
    fireEvent.click(
      screen.getByTestId("webhook-confirm-delete-01950000-0000-7000-8000-000000000501"),
    );
    await waitFor(() => {
      expect(screen.queryByTestId("webhooks-failing-summary")).toBeNull();
    });
  });

  it("blocks webhook requests and shows role notice for Member/Viewer brewery workspaces", async () => {
    const customFetch = vi.fn(async () => jsonResponse({ items: [] })) as unknown as typeof fetch;
    const onSwitchToPersonal = vi.fn();

    renderWithProviders(
      <WebhooksPanel
        serverUrl={SERVER_URL}
        authToken="tok"
        currentUserId={USER_ID}
        activeBrewery={BREWERY_MEMBER}
        onSwitchToPersonal={onSwitchToPersonal}
        customFetch={customFetch}
      />,
    );

    expect(screen.getByTestId("webhooks-readonly-banner").textContent).toContain(
      "Only Owners and Brewers",
    );
    expect(customFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("webhooks-switch-personal-button"));
    expect(onSwitchToPersonal).toHaveBeenCalledTimes(1);
  });
});

describe("BrewfatherPanel (P2-14)", () => {
  const samplePreview: BrewfatherImport = {
    recipes: [
      {
        ref: "recipe:Library9",
        draft: {
          name: "Harvest Pale Ale",
          beverage: "beer",
          batchSizeL: 18.927,
          visibility: "private",
          credit: {
            sourceUrl: "https://example.test/harvest-pale",
            site: "Harvest Brewery",
            author: "Recipe Author",
            publicSharingBlocked: false,
          },
          content: {
            schemaVersion: 1,
            efficiencyPct: 72,
            boilTimeMin: 60,
            fermentables: [
              {
                name: "Local malt blend",
                kind: "grain",
                amountKg: 4,
                use: "mash",
                potentialSg: 1.036,
                colorEbc: 4,
              },
            ],
            hops: [
              {
                name: "Columbus",
                catalogId: "hop-columbus",
                amountKg: 0.02,
                alphaAcidPct: 15,
                use: "boil",
                timeMin: 60,
              },
            ],
            yeasts: [],
            miscs: [],
            mash: [],
            fermentation: [],
          },
        },
      },
      {
        ref: "recipe:Own12",
        draft: {
          name: "House Cider",
          beverage: "cider",
          batchSizeL: 10,
          visibility: "private",
          content: {
            schemaVersion: 1,
            fermentables: [],
            hops: [],
            yeasts: [],
            miscs: [],
            mash: [],
            fermentation: [],
          },
        },
      },
    ],
    batches: [
      {
        recipeRef: "recipe:Library9",
        name: "Harvest Pale Batch #1",
        batchSizeL: 18.927,
        status: "fermenting",
        brewedAt: "2026-11-18T12:00:00Z",
        readings: [
          {
            takenAt: "2026-11-18T12:00:00Z",
            gravitySg: 1.054,
            temperatureC: 19.5,
            source: "device",
          },
          {
            takenAt: "2026-11-22T12:00:00Z",
            gravitySg: 1.012,
            temperatureC: 20.0,
            source: "device",
          },
        ],
      },
    ],
    inventory: [
      {
        name: "Local malt blend",
        quantity: 9,
        quantityUnit: "kg",
      },
      {
        name: "Columbus",
        catalogId: "hop-columbus",
        quantity: 0.1,
        quantityUnit: "kg",
        alphaAcidPct: 15,
      },
    ],
  };

  it("previews with one-time key, edits recipe draft preserving credit, maintains recipeRef invariant, converts inventory units, and saves without credentials", async () => {
    const savedPayloads: BrewfatherImport[] = [];
    let savedRawText = "";

    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname === "/api/integrations/brewfather/preview" && req.method === "POST") {
        const body = JSON.parse(await req.clone().text()) as { userId: string; apiKey: string };
        expect(body).toEqual({ userId: "bf-user-1", apiKey: "bf-secret-key" });
        return jsonResponse(samplePreview);
      }
      if (url.pathname === "/api/integrations/brewfather/import" && req.method === "POST") {
        savedRawText = await req.clone().text();
        savedPayloads.push(JSON.parse(savedRawText) as BrewfatherImport);
        return jsonResponse(
          {
            recipeIds: ["r-1"],
            batchIds: ["b-1"],
            inventoryIds: ["i-1", "i-2"],
          },
          201,
        );
      }
      if (url.pathname.startsWith("/api/equipment-profiles")) {
        return jsonResponse([]);
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    const { queryClient } = renderWithProviders(
      <>
        <UnitToggle />
        <BrewfatherPanel serverUrl={SERVER_URL} authToken="tok" customFetch={customFetch} />
      </>,
      "us",
      { strictMode: true },
    );

    // Privacy banner explains API key is never stored
    expect(screen.getByTestId("brewfather-key-privacy-banner").textContent).toContain(
      "never stored",
    );

    // Fetch preview
    fireEvent.change(screen.getByTestId("brewfather-user-id-input"), {
      target: { value: "bf-user-1" },
    });
    fireEvent.change(screen.getByTestId("brewfather-api-key-input"), {
      target: { value: "bf-secret-key" },
    });
    fireEvent.click(screen.getByTestId("brewfather-preview-button"));

    await waitFor(() => {
      expect(screen.getByTestId("brewfather-review-screen")).toBeTruthy();
    });

    // Credentials are cleared from TanStack Query mutation cache too (not retained in memory)
    await waitFor(() => {
      const cachedVars = JSON.stringify(
        queryClient
          .getMutationCache()
          .getAll()
          .map((m) => m.state.variables),
      );
      expect(cachedVars).not.toContain("bf-secret-key");
      expect(cachedVars).not.toContain("bf-user-1");
    });

    // Credit and unmatched free-text counts are visible on review screen
    expect(screen.getByTestId("brewfather-recipe-credit-0").textContent).toContain("Recipe Author");
    expect(screen.getByTestId("brewfather-recipe-credit-0").textContent).toContain(
      "Harvest Brewery",
    );
    expect(screen.getByTestId("brewfather-recipe-card-0").textContent).toContain("1 free text");
    expect(screen.getByTestId("brewfather-batch-card-0").textContent).toContain("2 readings");

    // Unchecking recipe 0 automatically unchecks its linked batch 0
    fireEvent.click(screen.getByTestId("brewfather-toggle-recipe-0"));
    expect(screen.getByTestId("brewfather-review-notice").textContent).toContain(
      "Unchecked 1 linked batch",
    );
    // Re-checking batch 0 automatically re-selects recipe 0
    fireEvent.click(screen.getByTestId("brewfather-toggle-batch-0"));
    expect(screen.getByTestId("brewfather-review-notice").textContent).toContain(
      'Re-selected linked recipe "Harvest Pale Ale"',
    );

    // Exclude recipe 1 (House Cider)
    fireEvent.click(screen.getByTestId("brewfather-toggle-recipe-1"));

    // Open full inline RecipeBuilder draft editor for recipe 0, change name, apply changes
    fireEvent.click(screen.getByTestId("brewfather-edit-recipe-0"));
    await waitFor(() => {
      expect(screen.getByTestId("brewfather-recipe-editor")).toBeTruthy();
    });
    expect(screen.getByTestId("import-credit-preview").textContent).toContain("Recipe Author");
    fireEvent.change(screen.getByTestId("recipe-name-input"), {
      target: { value: "Harvest Pale Ale (Reviewed)" },
    });
    fireEvent.click(screen.getByTestId("recipe-save-button"));

    await waitFor(() => {
      expect(screen.getByTestId("brewfather-review-screen")).toBeTruthy();
    });
    expect(screen.getByTestId("brewfather-recipe-card-0").textContent).toContain(
      "Harvest Pale Ale (Reviewed)",
    );
    expect(screen.getByTestId("brewfather-recipe-credit-0").textContent).toContain("Recipe Author");

    // Toggle units US -> Metric: 9 kg malt was ~19.84 lb, converts cleanly back to 9 kg
    const qtyInput = screen.getByTestId("brewfather-inv-qty-0") as HTMLInputElement;
    expect(Number(qtyInput.value)).toBeCloseTo(19.84, 1);
    fireEvent.click(screen.getByRole("tab", { name: "Use Metric units" }));
    await waitFor(() => {
      expect(
        Number((screen.getByTestId("brewfather-inv-qty-0") as HTMLInputElement).value),
      ).toBeCloseTo(9, 1);
    });

    // Save reviewed import -> verify zero credentials sent, strict recipe shape, preserved credit
    fireEvent.click(screen.getByTestId("brewfather-save-button"));

    await waitFor(() => {
      expect(screen.getByTestId("brewfather-complete-card")).toBeTruthy();
    });
    expect(screen.getByTestId("brewfather-complete-banner").textContent).toContain(
      "Imported 1 recipe, 1 batch, and 2 inventory items",
    );
    expect(savedRawText).not.toContain("bf-secret-key");
    expect(savedRawText).not.toContain("bf-user-1");
    const savedPayload = savedPayloads[0];
    expect(savedPayload?.recipes).toHaveLength(1);
    expect(savedPayload?.recipes[0]?.draft.name).toBe("Harvest Pale Ale (Reviewed)");
    expect(savedPayload?.recipes[0]?.draft.visibility).toBe("private");
    expect(savedPayload?.recipes[0]?.draft.credit?.author).toBe("Recipe Author");
    expect(savedPayload?.batches).toHaveLength(1);
    expect(savedPayload?.inventory[0]?.quantityUnit).toBe("kg");
    expect(savedPayload?.inventory[0]?.quantity).toBeCloseTo(9, 1);
  });
});
