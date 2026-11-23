// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminUser, AuthUser, UserToken } from "../src/api/auth";
import type { CatalogAttribution } from "../src/api/catalog";
import { AboutPanel, SOURCE_CODE_URL } from "../src/components/settings/AboutPanel";
import { AdminPanel } from "../src/components/settings/AdminPanel";
import { SettingsPanel } from "../src/components/settings/SettingsPanel";
import type { KeyValueStorage } from "../src/state/storage";
import { UnitsProvider, useUnits } from "../src/state/units";

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

const ADMIN_USER: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  uri: "http://brew.test/users/11111111-1111-4111-8111-111111111111",
  email: "admin@brew.test",
  displayName: "Head Brewer",
  isAdmin: true,
  units: "us",
};

function UnitReadout() {
  const { unitSystem } = useUnits();
  return <span data-testid="active-unit-system">{unitSystem}</span>;
}

describe("SettingsPanel", () => {
  it("updates display name and units on the server, changes password, and creates/revokes a personal API token", async () => {
    let tokens: UserToken[] = [];
    const requests: { method: string; url: string; body?: unknown }[] = [];

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const rawBody =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request && method !== "GET" && method !== "DELETE"
            ? await input.clone().text()
            : undefined;
      const parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : undefined;
      requests.push({ method, url, body: parsedBody });

      if (url.endsWith("/api/me") && method === "PATCH") {
        return jsonResponse({
          ...ADMIN_USER,
          displayName: String(parsedBody?.displayName ?? ADMIN_USER.displayName),
          units: (parsedBody?.units as "us" | "metric") ?? ADMIN_USER.units,
        });
      }
      if (url.endsWith("/api/me/password") && method === "POST") {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/api/auth/tokens") && method === "GET") {
        return jsonResponse(tokens);
      }
      if (url.endsWith("/api/auth/tokens") && method === "POST") {
        const created: UserToken = {
          id: "22222222-2222-4222-8222-222222222222",
          kind: "personal",
          name: String(parsedBody?.name ?? "Token"),
          scopes: (parsedBody?.scopes as string[]) ?? ["read", "write"],
          createdAt: "2026-11-22T20:00:00Z",
          lastUsedAt: null,
        };
        tokens = [created];
        return jsonResponse({ ...created, token: "bb_secret_token_12345" }, 201);
      }
      if (url.includes("/api/auth/tokens/") && method === "DELETE") {
        tokens = [];
        return new Response(null, { status: 204 });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <UnitsProvider initialUnitSystem="us" storage={noopStorage}>
          <UnitReadout />
          <SettingsPanel
            serverUrl="http://brew.test"
            authToken="tok-1"
            user={ADMIN_USER}
            customFetch={mockFetch}
          />
        </UnitsProvider>
      </QueryClientProvider>,
    );

    // 1. Update display name & units
    fireEvent.change(screen.getByTestId("settings-display-name-input"), {
      target: { value: "Master Brewer" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Metric SI units" }));
    fireEvent.click(screen.getByTestId("settings-save-profile-button"));

    await waitFor(() => {
      expect(screen.getByTestId("settings-profile-saved")).toBeTruthy();
    });
    expect(screen.getByTestId("active-unit-system").textContent).toBe("metric");
    expect(requests.some((r) => r.method === "PATCH" && r.url.endsWith("/api/me"))).toBe(true);

    // 2. Change password
    fireEvent.change(screen.getByTestId("settings-current-password-input"), {
      target: { value: "old-secret-123" },
    });
    fireEvent.change(screen.getByTestId("settings-new-password-input"), {
      target: { value: "new-secret-456" },
    });
    fireEvent.change(screen.getByTestId("settings-confirm-password-input"), {
      target: { value: "new-secret-456" },
    });
    fireEvent.click(screen.getByTestId("settings-change-password-button"));

    await waitFor(() => {
      expect(screen.getByTestId("settings-password-saved")).toBeTruthy();
    });

    // 3. Create & revoke personal API token
    fireEvent.change(screen.getByTestId("token-name-input"), {
      target: { value: "Tilt Bridge" },
    });
    fireEvent.click(screen.getByTestId("token-create-button"));

    await waitFor(() => {
      expect(screen.getByTestId("new-token-value").textContent).toBe("bb_secret_token_12345");
    });

    await waitFor(() => {
      expect(screen.getByTestId("token-revoke-22222222-2222-4222-8222-222222222222")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("token-revoke-22222222-2222-4222-8222-222222222222"));

    await waitFor(() => {
      expect(screen.queryByTestId("token-row-22222222-2222-4222-8222-222222222222")).toBeNull();
    });
  });
});

describe("AdminPanel", () => {
  it("shows signup mode, creates invites, disables/re-enables a user, and generates a reset link", async () => {
    const memberId = "33333333-3333-4333-8333-333333333333";
    let users: AdminUser[] = [
      {
        id: ADMIN_USER.id,
        email: ADMIN_USER.email,
        displayName: ADMIN_USER.displayName,
        isAdmin: true,
        disabled: false,
        createdAt: "2026-11-01T12:00:00Z",
      },
      {
        id: memberId,
        email: "member@brew.test",
        displayName: "Club Member",
        isAdmin: false,
        disabled: false,
        createdAt: "2026-11-10T12:00:00Z",
      },
    ];

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();

      if (url.endsWith("/api/auth/status")) {
        return jsonResponse({ setupNeeded: false, signupMode: "invite", oidcEnabled: false });
      }
      if (url.endsWith("/api/invites") && method === "POST") {
        return jsonResponse({ code: "INVITE-XYZ-789", expiresAt: "2026-11-29T12:00:00Z" }, 201);
      }
      if (url.endsWith("/api/admin/users") && method === "GET") {
        return jsonResponse(users);
      }
      if (url.endsWith(`/api/admin/users/${memberId}/disable`) && method === "POST") {
        users = users.map((u) => (u.id === memberId ? { ...u, disabled: true } : u));
        return jsonResponse(users.find((u) => u.id === memberId));
      }
      if (url.endsWith(`/api/admin/users/${memberId}/enable`) && method === "POST") {
        users = users.map((u) => (u.id === memberId ? { ...u, disabled: false } : u));
        return jsonResponse(users.find((u) => u.id === memberId));
      }
      if (url.endsWith(`/api/admin/users/${memberId}/password-reset`) && method === "POST") {
        return jsonResponse(
          {
            url: "http://brew.test/reset-password#token=reset-abc-123",
            expiresAt: "2026-11-23T20:00:00Z",
          },
          201,
        );
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <AdminPanel
          serverUrl="http://brew.test"
          authToken="tok-1"
          currentUser={ADMIN_USER}
          customFetch={mockFetch}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("admin-signup-mode").textContent).toBe("Invite-only");
    });

    // Create invite
    fireEvent.click(screen.getByTestId("admin-create-invite-button"));
    await waitFor(() => {
      expect(screen.getByTestId("admin-invite-code").textContent).toBe("INVITE-XYZ-789");
    });

    // Disable & re-enable member
    await waitFor(() => {
      expect(screen.getByTestId(`admin-toggle-disable-${memberId}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`admin-toggle-disable-${memberId}`));
    await waitFor(() => {
      expect(screen.getByTestId("admin-user-notice").textContent).toContain(
        "Disabled member@brew.test",
      );
    });

    // Create reset link
    fireEvent.click(screen.getByTestId(`admin-reset-link-button-${memberId}`));
    await waitFor(() => {
      expect(screen.getByTestId("admin-reset-link-value").textContent).toBe(
        "http://brew.test/reset-password#token=reset-abc-123",
      );
    });
  });

  it("blocks non-admin accounts from accessing admin controls", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AdminPanel
          serverUrl="http://brew.test"
          authToken="tok-1"
          currentUser={{ ...ADMIN_USER, isAdmin: false }}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Admin Access Required")).toBeTruthy();
  });
});

describe("AboutPanel", () => {
  it("renders AGPL-3.0-or-later license, source code link, and live catalog attribution", () => {
    const attribution: CatalogAttribution = {
      sources: {
        bjcpjson: {
          name: "BeerJSON bjcp-json",
          url: "https://github.com/beerjson/bjcp-json",
          license: "MIT",
          commit: "abcdef1234567890",
        },
        bt001: {
          name: "Brewtarget default content",
          url: "https://github.com/Brewtarget/brewtarget",
          license: "GPL-3.0",
          commit: "1234567890abcdef",
        },
      },
      attribution: "# Attribution\nThank you to open-source brewing data maintainers.",
    };

    render(<AboutPanel attribution={attribution} />);

    expect(screen.getByTestId("about-license-box").textContent).toContain("AGPL-3.0-or-later");
    expect(screen.getByTestId("about-source-code-link").textContent).toContain(SOURCE_CODE_URL);
    expect(screen.getByTestId("catalog-source-bjcpjson").textContent).toContain("MIT");
    expect(screen.getByTestId("catalog-source-bt001").textContent).toContain("GPL-3.0");
    expect(screen.getByTestId("about-attribution-markdown").textContent).toContain("Attribution");
  });

  it("renders bundled catalog sources and licenses when offline", () => {
    render(<AboutPanel attribution={null} />);
    expect(screen.getByTestId("about-license-box").textContent).toContain("AGPL-3.0-or-later");
    expect(screen.getByTestId("catalog-source-brewtarget").textContent).toContain("GPL-3.0");
    expect(screen.getByTestId("catalog-source-wallbrew").textContent).toContain("MIT");
    expect(screen.getByTestId("catalog-source-beer-analytics").textContent).toContain(
      "CC BY-SA 4.0",
    );
  });
});
