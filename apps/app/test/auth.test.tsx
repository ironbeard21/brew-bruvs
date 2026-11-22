// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthPanel } from "../src/components/AuthPanel";

afterEach(cleanup);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderAuthPanel(opts: {
  customFetch: typeof fetch;
  authToken?: string | null;
  onTokenChange?: (token: string | null) => Promise<void>;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthPanel
        serverUrl="http://localhost:8080"
        authToken={opts.authToken ?? null}
        onTokenChange={opts.onTokenChange ?? (async () => {})}
        onOpenCalculators={() => {}}
        customFetch={opts.customFetch}
      />
    </QueryClientProvider>,
  );
}

describe("AuthPanel", () => {
  it("completes first-run admin setup when setupNeeded is true", async () => {
    let signedIn = false;
    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");

      if (url.endsWith("/api/auth/status")) {
        return jsonResponse({ setupNeeded: !signedIn, signupMode: "invite", oidcEnabled: false });
      }
      if (url.endsWith("/api/me")) {
        return signedIn
          ? jsonResponse({
              id: "01950000-0000-7000-8000-000000000001",
              uri: "http://localhost:8080/users/admin",
              email: "admin@brew.test",
              displayName: "Head Brewer",
              isAdmin: true,
            })
          : jsonResponse({ error: { code: "unauthorized", message: "Sign in first" } }, 401);
      }
      if (url.endsWith("/api/setup") && method === "POST") {
        signedIn = true;
        return jsonResponse(
          {
            user: {
              id: "01950000-0000-7000-8000-000000000001",
              uri: "http://localhost:8080/users/admin",
              email: "admin@brew.test",
              displayName: "Head Brewer",
              isAdmin: true,
            },
          },
          201,
        );
      }
      return jsonResponse({ error: { code: "not_found", message: "Not found" } }, 404);
    };

    renderAuthPanel({ customFetch: mockFetch });

    await waitFor(() => expect(screen.getByText("First-Run Admin Setup")).toBeTruthy());

    fireEvent.change(screen.getByTestId("auth-display-name-input"), {
      target: { value: "Head Brewer" },
    });
    fireEvent.change(screen.getByTestId("auth-email-input"), {
      target: { value: "admin@brew.test" },
    });
    fireEvent.change(screen.getByTestId("auth-password-input"), {
      target: { value: "hop-secret-123" },
    });
    fireEvent.click(screen.getByTestId("auth-setup-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("signed-in-name").textContent).toBe("Head Brewer"),
    );
    expect(screen.getByTestId("signed-in-email").textContent).toBe("admin@brew.test");
    expect(screen.getByText("Admin")).toBeTruthy();
  });

  it("handles wrong password, successful login, and logout", async () => {
    let signedIn = false;
    const onTokenChange = vi.fn(async () => {});

    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");

      if (url.endsWith("/api/auth/status")) {
        return jsonResponse({ setupNeeded: false, signupMode: "invite", oidcEnabled: true });
      }
      if (url.endsWith("/api/me")) {
        return signedIn
          ? jsonResponse({
              id: "01950000-0000-7000-8000-000000000002",
              uri: "http://localhost:8080/users/brewer",
              email: "brewer@brew.test",
              displayName: "Malt Master",
              isAdmin: false,
            })
          : jsonResponse({ error: { code: "unauthorized", message: "Sign in first" } }, 401);
      }
      if (url.endsWith("/api/auth/login") && method === "POST") {
        const raw =
          input instanceof Request
            ? await input.text()
            : typeof init?.body === "string"
              ? init.body
              : "";
        const parsed = JSON.parse(raw) as { email: string; password: string };
        if (parsed.password !== "correct-horse-battery") {
          return jsonResponse(
            { error: { code: "invalid_credentials", message: "Wrong email or password" } },
            401,
          );
        }
        signedIn = true;
        return jsonResponse({
          user: {
            id: "01950000-0000-7000-8000-000000000002",
            uri: "http://localhost:8080/users/brewer",
            email: "brewer@brew.test",
            displayName: "Malt Master",
            isAdmin: false,
          },
          token: "app-token-123",
        });
      }
      if (url.endsWith("/api/auth/logout") && method === "POST") {
        signedIn = false;
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ error: { code: "not_found", message: "Not found" } }, 404);
    };

    renderAuthPanel({ customFetch: mockFetch, onTokenChange });

    await waitFor(() => expect(screen.getByTestId("auth-login-submit")).toBeTruthy());
    expect(screen.getByTestId("auth-oidc-button")).toBeTruthy();

    fireEvent.change(screen.getByTestId("auth-email-input"), {
      target: { value: "brewer@brew.test" },
    });
    fireEvent.change(screen.getByTestId("auth-password-input"), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByTestId("auth-login-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("auth-error").textContent).toBe("Wrong email or password"),
    );

    fireEvent.change(screen.getByTestId("auth-password-input"), {
      target: { value: "correct-horse-battery" },
    });
    fireEvent.click(screen.getByTestId("auth-login-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("signed-in-name").textContent).toBe("Malt Master"),
    );
    expect(onTokenChange).toHaveBeenCalledWith("app-token-123");

    fireEvent.click(screen.getByTestId("logout-button"));
    await waitFor(() => expect(screen.getByTestId("auth-login-submit")).toBeTruthy());
    expect(onTokenChange).toHaveBeenCalledWith(null);
  });

  it("shows invite code field on signup when server is invite-only", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/auth/status")) {
        return jsonResponse({ setupNeeded: false, signupMode: "invite", oidcEnabled: false });
      }
      if (url.endsWith("/api/me")) {
        return jsonResponse({ error: { code: "unauthorized", message: "Sign in first" } }, 401);
      }
      return jsonResponse({ error: { code: "not_found", message: "Not found" } }, 404);
    };

    renderAuthPanel({ customFetch: mockFetch });

    await waitFor(() => expect(screen.getByLabelText("Create a new account")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Create a new account"));

    expect(screen.getByTestId("auth-invite-code-input")).toBeTruthy();
  });
});
