// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SaveToBatchNote } from "../src/components/calculators/CalculatorExtras";
import { ServerProvider } from "../src/state/server";

afterEach(cleanup);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("SaveToBatchNote", () => {
  it("stays hidden when not connected or signed out", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const signedOutFetch: typeof fetch = async () =>
      jsonResponse({ error: { code: "unauthorized", message: "Sign in first" } }, 401);

    render(
      <QueryClientProvider client={queryClient}>
        <ServerProvider initialServerUrl="http://localhost:8080">
          <SaveToBatchNote calculatorName="ABV" noteBody="5.64% ABV" customFetch={signedOutFetch} />
        </ServerProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId("save-to-batch-toggle")).toBeNull());
  });

  it("loads user batches and saves a note via POST /api/notes when signed in", async () => {
    const savedPayloads: unknown[] = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");

      if (url.endsWith("/api/me")) {
        return jsonResponse({
          id: "01950000-0000-7000-8000-000000000001",
          uri: "http://localhost:8080/users/admin",
          email: "admin@brew.test",
          displayName: "Head Brewer",
          isAdmin: true,
        });
      }
      if (url.includes("/api/batches") && method === "GET") {
        return jsonResponse({
          items: [
            {
              id: "01950000-0000-7000-8000-000000000010",
              uri: "http://localhost:8080/batches/1",
              name: "Autumn Pale Ale #1",
              beverage: "beer",
              status: "fermenting",
              visibility: "private",
              owner: { type: "user", id: "01950000-0000-7000-8000-000000000001" },
              recipe: {
                id: "01950000-0000-7000-8000-000000000020",
                version: 1,
                versionId: "01950000-0000-7000-8000-000000000021",
              },
              batchSizeL: 19,
              equipmentProfileId: null,
              brewedAt: null,
              completedAt: null,
              createdAt: "2026-11-22T00:00:00.000Z",
              updatedAt: "2026-11-22T00:00:00.000Z",
            },
          ],
          nextOffset: null,
        });
      }
      if (url.endsWith("/api/notes") && method === "POST") {
        const raw =
          input instanceof Request
            ? await input.text()
            : typeof init?.body === "string"
              ? init.body
              : "";
        savedPayloads.push(JSON.parse(raw));
        return jsonResponse(
          {
            id: "01950000-0000-7000-8000-000000000099",
            uri: "http://localhost:8080/notes/1",
            kind: "general",
            body: "ABV & Attenuation: 5.64% ABV",
            recipeId: null,
            batchId: "01950000-0000-7000-8000-000000000010",
            scores: null,
            visibility: "private",
            owner: { type: "user", id: "01950000-0000-7000-8000-000000000001" },
            createdAt: "2026-11-22T00:00:00.000Z",
            updatedAt: "2026-11-22T00:00:00.000Z",
          },
          201,
        );
      }
      return jsonResponse({ error: { code: "not_found", message: "Not found" } }, 404);
    };

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ServerProvider initialServerUrl="http://localhost:8080">
          <SaveToBatchNote
            calculatorName="ABV & Attenuation"
            noteBody="5.64% ABV"
            customFetch={mockFetch}
          />
        </ServerProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("save-to-batch-toggle")).toBeTruthy());
    fireEvent.click(screen.getByTestId("save-to-batch-toggle"));

    await waitFor(() =>
      expect(screen.getByTestId("batch-option-01950000-0000-7000-8000-000000000010")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId("save-to-batch-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("save-to-batch-success").textContent).toContain(
        "Autumn Pale Ale #1",
      ),
    );
    expect(savedPayloads).toEqual([
      {
        kind: "general",
        batchId: "01950000-0000-7000-8000-000000000010",
        body: "ABV & Attenuation: 5.64% ABV",
      },
    ]);
  });
});
