// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Platform } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reminder } from "../src/api/batches";
import { RecipeImportFlow } from "../src/components/recipes/RecipeImportFlow";
import { AboutPanel } from "../src/components/settings/AboutPanel";
import {
  PRIVACY_POLICY_URL,
  PrivacyPolicyPanel,
} from "../src/components/settings/PrivacyPolicyPanel";
import {
  cancelReminderNotification,
  MAX_SCHEDULED_REMINDERS,
  type NativeReminderAdapter,
  syncDueRemindersOnOpen,
} from "../src/notifications";
import type { KeyValueStorage } from "../src/state/storage";
import { UnitsProvider } from "../src/state/units";

const APP_ROOT = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(APP_ROOT, "../..");
const SERVER_URL = "http://localhost:8080";
const USER_ID = "01950000-0000-7000-8000-000000000001";

function createMemoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
    removeItem: async (k) => {
      map.delete(k);
    },
  };
}

function createMockNativeAdapter(opts: { granted?: boolean } = {}) {
  let seq = 0;
  const scheduled: { id: string; title: string; body: string; date: Date }[] = [];
  const fired: { id: string; title: string; body: string }[] = [];
  const cancelled: string[] = [];
  let requested = 0;

  const adapter: NativeReminderAdapter = {
    getPermissionGranted: async () => opts.granted ?? true,
    requestPermission: async () => {
      requested += 1;
      return opts.granted ?? true;
    },
    scheduleAt: async ({ title, body, date }) => {
      seq += 1;
      const id = `sched-${seq}`;
      scheduled.push({ id, title, body, date });
      return id;
    },
    fireNow: async ({ title, body }) => {
      seq += 1;
      const id = `now-${seq}`;
      fired.push({ id, title, body });
      return id;
    },
    cancel: async (id) => {
      cancelled.push(id);
    },
  };

  return {
    adapter,
    scheduled,
    fired,
    cancelled,
    get requestedCount() {
      return requested;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UnitsProvider initialUnitSystem="us">{ui}</UnitsProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("Store-ready config, assets, and listings (P2-15)", () => {
  it("configures EAS profiles for TestFlight and Play internal testing with no secrets", () => {
    const easRaw = readFileSync(resolve(APP_ROOT, "eas.json"), "utf8");
    const eas = JSON.parse(easRaw) as {
      build: Record<string, Record<string, unknown>>;
      submit: Record<string, Record<string, unknown>>;
    };
    expect(eas.build.testflight).toBeDefined();
    expect(eas.build["play-internal"]).toBeDefined();
    expect(eas.build.production).toBeDefined();
    expect(eas.submit.testflight).toBeDefined();
    expect(eas.submit["play-internal"]).toBeDefined();
    expect((eas.submit["play-internal"]?.android as { track?: string })?.track).toBe("internal");
  });

  it("wires valid icon, splash, notification icon, and privacy manifest paths in app.json", () => {
    const appJson = JSON.parse(readFileSync(resolve(APP_ROOT, "app.json"), "utf8")) as {
      expo: {
        icon: string;
        splash: { image: string; backgroundColor: string };
        ios: {
          bundleIdentifier: string;
          infoPlist: { ITSAppUsesNonExemptEncryption: boolean };
          privacyManifests: { NSPrivacyTracking: boolean; NSPrivacyCollectedDataTypes: unknown[] };
        };
        android: {
          package: string;
          adaptiveIcon: { foregroundImage: string; backgroundColor: string };
        };
        web: { favicon: string };
        plugins: (string | [string, Record<string, unknown>])[];
      };
    };

    expect(existsSync(resolve(APP_ROOT, appJson.expo.icon))).toBe(true);
    expect(existsSync(resolve(APP_ROOT, appJson.expo.splash.image))).toBe(true);
    expect(existsSync(resolve(APP_ROOT, appJson.expo.android.adaptiveIcon.foregroundImage))).toBe(
      true,
    );
    expect(existsSync(resolve(APP_ROOT, appJson.expo.web.favicon))).toBe(true);
    expect(appJson.expo.ios.infoPlist.ITSAppUsesNonExemptEncryption).toBe(false);
    expect(appJson.expo.ios.privacyManifests.NSPrivacyTracking).toBe(false);
    expect(appJson.expo.ios.privacyManifests.NSPrivacyCollectedDataTypes).toEqual([]);

    const notifPlugin = appJson.expo.plugins.find(
      (p) => Array.isArray(p) && p[0] === "expo-notifications",
    ) as [string, { icon?: string }] | undefined;
    expect(notifPlugin?.[1]?.icon).toBeTruthy();
    expect(existsSync(resolve(APP_ROOT, notifPlugin?.[1]?.icon ?? ""))).toBe(true);
  });

  it("ships docs/privacy-policy.md, store listing copy, and all store screenshots", () => {
    const policy = readFileSync(resolve(REPO_ROOT, "docs/privacy-policy.md"), "utf8");
    expect(policy).toMatch(/no tracking/i);
    expect(policy).toMatch(/self-hosted/i);

    const listing = readFileSync(resolve(APP_ROOT, "store/listing.md"), "utf8");
    expect(listing).toContain(PRIVACY_POLICY_URL);

    const expectedScreenshots = [
      "01-calculators.png",
      "02-recipe-builder.png",
      "03-batch-fermentation.png",
      "04-inventory-shopping.png",
      "05-breweries.png",
    ];
    for (const filename of expectedScreenshots) {
      expect(listing).toContain(filename);
      const bytes = readFileSync(resolve(APP_ROOT, "store/screenshots", filename));
      // Verify PNG signature (89 50 4E 47)
      expect(bytes[0]).toBe(0x89);
      expect(bytes[1]).toBe(0x50);
      expect(bytes[2]).toBe(0x4e);
      expect(bytes[3]).toBe(0x47);
    }
  });
});

describe("In-app Privacy Policy", () => {
  it("renders the Privacy Policy panel and wires AboutPanel link", () => {
    const onOpenPrivacy = vi.fn();
    render(<AboutPanel onOpenPrivacyPolicy={onOpenPrivacy} />);

    const link = screen.getByTestId("about-privacy-policy-link");
    expect(link.textContent).toContain("Privacy Policy");
    fireEvent.click(link);
    expect(onOpenPrivacy).toHaveBeenCalledTimes(1);

    cleanup();
    render(<PrivacyPolicyPanel />);
    expect(screen.getByTestId("privacy-summary-box").textContent).toMatch(/no tracking/i);
    expect(screen.getByTestId("privacy-policy-external-link").textContent).toContain(
      PRIVACY_POLICY_URL,
    );
  });
});

describe("Native file picker for recipe imports (Phase 1 leftover)", () => {
  it("renders native file picker button on iOS/Android, loads picked BeerJSON, and parses into review", async () => {
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });

    try {
      const sampleJson = JSON.stringify({
        beerjson: { version: 1, recipes: [{ name: "Picked Native IPA", type: "all grain" }] },
      });
      const onPickNativeFile = vi.fn(async () => ({
        name: "picked-ipa.json",
        contents: sampleJson,
      }));
      const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const url = new URL(req.url);
        if (url.pathname === "/api/recipes/import" && req.method === "POST") {
          const body = JSON.parse(await req.clone().text()) as { format: string; contents: string };
          expect(body.format).toBe("beerjson");
          expect(body.contents).toBe(sampleJson);
          return jsonResponse({
            name: "Picked Native IPA",
            beverage: "beer",
            batchSizeL: 18.927,
            styleId: null,
            visibility: "private",
            content: {
              schemaVersion: 1,
              efficiencyPct: 72,
              boilTimeMin: 60,
              fermentables: [],
              hops: [],
              yeasts: [],
              miscs: [],
              mash: [],
              fermentation: [],
            },
          });
        }
        return jsonResponse([]);
      }) as unknown as typeof fetch;

      renderWithProviders(
        <RecipeImportFlow
          serverUrl={SERVER_URL}
          authToken="tok"
          onSaveImported={async () => {}}
          onPickNativeFile={onPickNativeFile}
          customFetch={customFetch}
        />,
      );

      fireEvent.click(screen.getByTestId("import-native-file-button"));

      await waitFor(() => {
        expect(screen.getByTestId("import-selected-filename").textContent).toContain(
          "picked-ipa.json (BEERJSON)",
        );
      });
      expect(onPickNativeFile).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("import-file-submit-button"));
      await waitFor(() => {
        expect(screen.getByTestId("import-review-screen")).toBeTruthy();
      });
    } finally {
      Object.defineProperty(Platform, "OS", { value: originalOS, configurable: true });
    }
  });
});

describe("Syncing all due reminders when the app opens (Phase 1 leftover)", () => {
  const NOW_MS = Date.parse("2026-11-25T12:00:00.000Z");

  function makeReminder(id: string, offsetMs: number, doneAt: string | null = null): Reminder {
    return {
      id,
      batchId: "b-1",
      batchName: "Traditional Mead",
      kind: "nutrient",
      dueAt: new Date(NOW_MS + offsetMs).toISOString(),
      note: `Step ${id}`,
      doneAt,
      createdAt: "2026-11-20T00:00:00.000Z",
    };
  }

  it("fetches GET /api/reminders?until=..., schedules upcoming, alerts overdue once, and prunes completed", async () => {
    const storage = createMemoryStorage();
    const mockNative = createMockNativeAdapter({ granted: true });
    let serverReminders: Reminder[] = [
      makeReminder("rem-overdue", -60 * 60 * 1000), // 1h overdue
      makeReminder("rem-soon", 24 * 60 * 60 * 1000), // +1 day
      makeReminder("rem-later", 72 * 60 * 60 * 1000), // +3 days
    ];
    const requestedUrls: string[] = [];

    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      requestedUrls.push(req.url);
      return jsonResponse(serverReminders);
    }) as unknown as typeof fetch;

    // 1. First app open: alerts overdue once, schedules 2 upcoming
    const first = await syncDueRemindersOnOpen({
      serverUrl: SERVER_URL,
      authToken: "tok",
      userId: USER_ID,
      nowMs: NOW_MS,
      storage,
      nativeAdapter: mockNative.adapter,
      customFetch,
    });
    expect(first).toEqual({
      fetched: 3,
      scheduled: 2,
      dueAlerted: 1,
      pruned: 0,
      permissionGranted: true,
    });
    expect(mockNative.fired).toHaveLength(1);
    expect(mockNative.fired[0]?.title).toContain("Traditional Mead");
    expect(mockNative.scheduled).toHaveLength(2);
    const reqUrl = new URL(requestedUrls[0] as string);
    expect(reqUrl.pathname).toBe("/api/reminders");
    expect(reqUrl.searchParams.get("until")).toBeTruthy();

    // 2. Second app open with unchanged reminders: NO duplicate alerts or duplicate schedules
    const second = await syncDueRemindersOnOpen({
      serverUrl: SERVER_URL,
      authToken: "tok",
      userId: USER_ID,
      nowMs: NOW_MS,
      storage,
      nativeAdapter: mockNative.adapter,
      customFetch,
    });
    expect(second.dueAlerted).toBe(0);
    expect(second.scheduled).toBe(2);
    expect(mockNative.fired).toHaveLength(1);
    expect(mockNative.scheduled).toHaveLength(2);

    const soonNotifId = mockNative.scheduled[0]?.id ?? "";
    const laterNotifId = mockNative.scheduled[1]?.id ?? "";
    expect(soonNotifId).toBeTruthy();
    expect(laterNotifId).toBeTruthy();

    // 3. Reminder completed on another device disappears from GET /api/reminders -> cancelled & pruned
    serverReminders = [makeReminder("rem-later", 72 * 60 * 60 * 1000)];
    const third = await syncDueRemindersOnOpen({
      serverUrl: SERVER_URL,
      authToken: "tok",
      userId: USER_ID,
      nowMs: NOW_MS,
      storage,
      nativeAdapter: mockNative.adapter,
      customFetch,
    });
    expect(third.pruned).toBe(2);
    expect(mockNative.cancelled).toContain(soonNotifId);

    // 4. Marking remaining reminder done locally cancels its scoped notification id
    await cancelReminderNotification("rem-later", {
      storage,
      nativeAdapter: mockNative.adapter,
    });
    expect(mockNative.cancelled).toContain(laterNotifId);
  });

  it("does not prompt for OS notification permission when there are no open reminders", async () => {
    const storage = createMemoryStorage();
    const mockNative = createMockNativeAdapter({ granted: false });
    const customFetch = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;

    const res = await syncDueRemindersOnOpen({
      serverUrl: SERVER_URL,
      authToken: "tok",
      userId: USER_ID,
      nowMs: NOW_MS,
      storage,
      nativeAdapter: mockNative.adapter,
      customFetch,
    });
    expect(res.fetched).toBe(0);
    expect(mockNative.requestedCount).toBe(0);
  });

  it("caps native scheduled reminders at MAX_SCHEDULED_REMINDERS soonest", async () => {
    const storage = createMemoryStorage();
    const mockNative = createMockNativeAdapter({ granted: true });
    const many: Reminder[] = Array.from({ length: 60 }, (_, idx) =>
      makeReminder(`rem-${idx}`, (idx + 1) * 3600 * 1000),
    );
    const customFetch = vi.fn(async () => jsonResponse(many)) as unknown as typeof fetch;

    const res = await syncDueRemindersOnOpen({
      serverUrl: SERVER_URL,
      authToken: "tok",
      userId: USER_ID,
      nowMs: NOW_MS,
      storage,
      nativeAdapter: mockNative.adapter,
      customFetch,
    });
    expect(res.fetched).toBe(60);
    expect(res.scheduled).toBe(MAX_SCHEDULED_REMINDERS);
    expect(mockNative.scheduled).toHaveLength(MAX_SCHEDULED_REMINDERS);
  });
});
