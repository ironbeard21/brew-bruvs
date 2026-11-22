// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Pressable, Text, View } from "react-native";
import { afterEach, describe, expect, it } from "vitest";
import { verifyServerHealth } from "../src/api/health";
import { normalizeServerUrl, ServerProvider, useServer } from "../src/state/server";
import type { KeyValueStorage } from "../src/state/storage";

afterEach(cleanup);

function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    async getItem(key) {
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}

describe("normalizeServerUrl", () => {
  it("adds http:// for localhost and loopback addresses without a scheme", () => {
    expect(normalizeServerUrl("localhost:3000")).toEqual({
      ok: true,
      url: "http://localhost:3000",
    });
    expect(normalizeServerUrl("127.0.0.1:4100/")).toEqual({
      ok: true,
      url: "http://127.0.0.1:4100",
    });
  });

  it("adds https:// for remote hosts and strips trailing slashes", () => {
    expect(normalizeServerUrl("  brew.example.com/// ")).toEqual({
      ok: true,
      url: "https://brew.example.com",
    });
    expect(normalizeServerUrl("https://brew.example.com/sub/")).toEqual({
      ok: true,
      url: "https://brew.example.com/sub",
    });
  });

  it("rejects blank, non-http, and malformed addresses", () => {
    expect(normalizeServerUrl("   ").ok).toBe(false);
    expect(normalizeServerUrl("ftp://brew.example.com").ok).toBe(false);
    expect(normalizeServerUrl("http://bad host name").ok).toBe(false);
  });
});

describe("verifyServerHealth", () => {
  it("succeeds when /healthz returns status ok", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe("http://localhost:3000/healthz");
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await verifyServerHealth("localhost:3000/", mockFetch);
    expect(result).toEqual({ url: "http://localhost:3000", status: "ok" });
  });

  it("surfaces API error messages and network failures", async () => {
    const failFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({ error: { code: "unavailable", message: "Maintenance mode" } }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      );

    await expect(verifyServerHealth("https://brew.example.com", failFetch)).rejects.toThrow(
      "Maintenance mode",
    );

    const networkErrorFetch: typeof fetch = async () => {
      throw new Error("Failed to fetch");
    };

    await expect(verifyServerHealth("https://brew.example.com", networkErrorFetch)).rejects.toThrow(
      "Failed to fetch",
    );
  });
});

function ServerProviderHarness() {
  const {
    hydrated,
    serverUrl,
    savedServers,
    offlineMode,
    selectServer,
    disconnectServer,
    removeSavedServer,
    enterOfflineMode,
  } = useServer();

  return (
    <View>
      <Text testID="hydrated">{String(hydrated)}</Text>
      <Text testID="active">{serverUrl ?? "none"}</Text>
      <Text testID="saved">{savedServers.join(",") || "empty"}</Text>
      <Text testID="offline">{String(offlineMode)}</Text>
      <Pressable testID="select-a" onPress={() => void selectServer("http://localhost:3000/")}>
        <Text>Select A</Text>
      </Pressable>
      <Pressable testID="select-b" onPress={() => void selectServer("brew.example.com")}>
        <Text>Select B</Text>
      </Pressable>
      <Pressable testID="disconnect" onPress={() => void disconnectServer()}>
        <Text>Disconnect</Text>
      </Pressable>
      <Pressable testID="remove-a" onPress={() => void removeSavedServer("http://localhost:3000")}>
        <Text>Remove A</Text>
      </Pressable>
      <Pressable testID="offline-btn" onPress={() => void enterOfflineMode()}>
        <Text>Offline</Text>
      </Pressable>
    </View>
  );
}

describe("ServerProvider", () => {
  it("persists active server, supports switching servers, and toggles offline mode", async () => {
    const storage = createMemoryStorage();
    render(
      <ServerProvider storage={storage}>
        <ServerProviderHarness />
      </ServerProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    expect(screen.getByTestId("active").textContent).toBe("none");

    fireEvent.click(screen.getByTestId("select-a"));
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe("http://localhost:3000"),
    );

    fireEvent.click(screen.getByTestId("select-b"));
    await waitFor(() =>
      expect(screen.getByTestId("active").textContent).toBe("https://brew.example.com"),
    );
    expect(screen.getByTestId("saved").textContent).toBe(
      "https://brew.example.com,http://localhost:3000",
    );

    fireEvent.click(screen.getByTestId("remove-a"));
    await waitFor(() =>
      expect(screen.getByTestId("saved").textContent).toBe("https://brew.example.com"),
    );

    fireEvent.click(screen.getByTestId("disconnect"));
    await waitFor(() => expect(screen.getByTestId("active").textContent).toBe("none"));

    fireEvent.click(screen.getByTestId("offline-btn"));
    await waitFor(() => expect(screen.getByTestId("offline").textContent).toBe("true"));
  });
});
