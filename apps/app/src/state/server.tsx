// SPDX-License-Identifier: AGPL-3.0-or-later
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { appStorage, type KeyValueStorage } from "./storage";

const ACTIVE_SERVER_KEY = "brewbruvs.server.active";
const SAVED_SERVERS_KEY = "brewbruvs.server.saved";
const OFFLINE_MODE_KEY = "brewbruvs.server.offline";
const TOKEN_KEY_PREFIX = "brewbruvs.token.";

function tokenKeyFor(url: string): string {
  // SecureStore keys allow alphanumeric, '.', '-', '_' only.
  return `${TOKEN_KEY_PREFIX}${encodeURIComponent(url).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
}

export type NormalizedUrlResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Normalizes a user-entered Brew-Bruvs server address:
 * - Defaults localhost / loopback hosts to http:// and remote hosts to https:// when no scheme is given.
 * - Rejects non-http(s) protocols and invalid URLs.
 * - Strips trailing slashes so API paths join cleanly.
 */
export function normalizeServerUrl(raw: string): NormalizedUrlResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a server address (for example, https://brew.example.com)." };
  }

  let candidate = trimmed;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/|$)/i.test(candidate);
    candidate = `${isLocal ? "http" : "https"}://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: "That doesn't look like a valid server address." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Server address must start with http:// or https://." };
  }

  if (!parsed.hostname) {
    return { ok: false, error: "Server address must include a hostname." };
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${parsed.origin}${pathname}` };
}

export function getSuggestedWebServerUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = window.location.origin;
    if (origin.startsWith("http://") || origin.startsWith("https://")) {
      return origin;
    }
  }
  return "";
}

interface ServerContextValue {
  /** Whether persisted server state has finished loading. */
  hydrated: boolean;
  /** Currently selected Brew-Bruvs server URL, or null when unconnected / offline-only. */
  serverUrl: string | null;
  /** Native revocable app token for the active server (null on web, which uses HttpOnly cookies). */
  authToken: string | null;
  /** Previously connected servers for quick switching. */
  savedServers: string[];
  /** True when the user chose to use offline calculators without connecting a server. */
  offlineMode: boolean;
  /** Saves and activates a verified server URL, loading any stored native token for it. */
  selectServer: (url: string) => Promise<void>;
  /** Saves or clears the native app token for the active server. */
  setAuthToken: (token: string | null) => Promise<void>;
  /** Clears the active server while keeping saved servers available to switch back to. */
  disconnectServer: () => Promise<void>;
  /** Removes a server from the saved list and deletes its stored token (disconnecting if active). */
  removeSavedServer: (url: string) => Promise<void>;
  /** Enters offline calculator mode without requiring a server. */
  enterOfflineMode: () => Promise<void>;
}

const ServerContext = createContext<ServerContextValue | null>(null);

function parseSavedServers(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
    }
  } catch {
    // Ignore malformed saved list.
  }
  return [];
}

export interface ServerProviderProps {
  children: ReactNode;
  storage?: KeyValueStorage;
  initialServerUrl?: string | null;
}

export function ServerProvider({
  children,
  storage = appStorage,
  initialServerUrl,
}: ServerProviderProps) {
  const [hydrated, setHydrated] = useState(initialServerUrl !== undefined);
  const [serverUrl, setServerUrl] = useState<string | null>(initialServerUrl ?? null);
  const [authToken, setAuthTokenState] = useState<string | null>(null);
  const [savedServers, setSavedServers] = useState<string[]>(
    initialServerUrl ? [initialServerUrl] : [],
  );
  const [offlineMode, setOfflineMode] = useState(false);

  useEffect(() => {
    if (initialServerUrl !== undefined) return;
    let active = true;
    void Promise.all([
      storage.getItem(ACTIVE_SERVER_KEY),
      storage.getItem(SAVED_SERVERS_KEY),
      storage.getItem(OFFLINE_MODE_KEY),
    ]).then(async ([savedActive, savedList, savedOffline]) => {
      const activeUrl = savedActive || null;
      const savedToken = activeUrl ? await storage.getItem(tokenKeyFor(activeUrl)) : null;
      if (!active) return;
      setSavedServers(parseSavedServers(savedList));
      setServerUrl(activeUrl);
      setAuthTokenState(savedToken);
      setOfflineMode(savedOffline === "true");
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, [initialServerUrl, storage]);

  const selectServer = useCallback(
    async (url: string) => {
      const normalized = normalizeServerUrl(url);
      if (!normalized.ok) {
        throw new Error(normalized.error);
      }
      const nextUrl = normalized.url;
      const nextList = [nextUrl, ...savedServers.filter((item) => item !== nextUrl)];
      const existingToken = await storage.getItem(tokenKeyFor(nextUrl));
      setServerUrl(nextUrl);
      setAuthTokenState(existingToken);
      setOfflineMode(false);
      setSavedServers(nextList);
      await Promise.all([
        storage.setItem(ACTIVE_SERVER_KEY, nextUrl),
        storage.setItem(SAVED_SERVERS_KEY, JSON.stringify(nextList)),
        storage.removeItem(OFFLINE_MODE_KEY),
      ]);
    },
    [savedServers, storage],
  );

  const setAuthToken = useCallback(
    async (token: string | null) => {
      setAuthTokenState(token);
      if (!serverUrl) return;
      if (token) {
        await storage.setItem(tokenKeyFor(serverUrl), token);
      } else {
        await storage.removeItem(tokenKeyFor(serverUrl));
      }
    },
    [serverUrl, storage],
  );

  const disconnectServer = useCallback(async () => {
    setServerUrl(null);
    setAuthTokenState(null);
    setOfflineMode(false);
    await Promise.all([
      storage.removeItem(ACTIVE_SERVER_KEY),
      storage.removeItem(OFFLINE_MODE_KEY),
    ]);
  }, [storage]);

  const removeSavedServer = useCallback(
    async (url: string) => {
      const nextList = savedServers.filter((item) => item !== url);
      setSavedServers(nextList);
      const ops: Promise<void>[] = [
        storage.setItem(SAVED_SERVERS_KEY, JSON.stringify(nextList)),
        storage.removeItem(tokenKeyFor(url)),
      ];
      if (serverUrl === url) {
        setServerUrl(null);
        setAuthTokenState(null);
        ops.push(storage.removeItem(ACTIVE_SERVER_KEY));
      }
      await Promise.all(ops);
    },
    [savedServers, serverUrl, storage],
  );

  const enterOfflineMode = useCallback(async () => {
    setOfflineMode(true);
    await storage.setItem(OFFLINE_MODE_KEY, "true");
  }, [storage]);

  return (
    <ServerContext.Provider
      value={{
        hydrated,
        serverUrl,
        authToken,
        savedServers,
        offlineMode,
        selectServer,
        setAuthToken,
        disconnectServer,
        removeSavedServer,
        enterOfflineMode,
      }}
    >
      {children}
    </ServerContext.Provider>
  );
}

export function useOptionalServer(): ServerContextValue | null {
  return useContext(ServerContext);
}

export function useServer(): ServerContextValue {
  const ctx = useContext(ServerContext);
  if (!ctx) {
    throw new Error("useServer must be used within a ServerProvider");
  }
  return ctx;
}
