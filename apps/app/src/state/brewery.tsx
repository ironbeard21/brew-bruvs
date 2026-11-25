// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useCurrentUser } from "../api/auth";
import {
  type Brewery,
  type BreweryRole,
  useBreweries,
  useMyBreweryInvites,
} from "../api/breweries";
import { canWriteBrewery } from "./permissions";
import { useOptionalServer } from "./server";
import { appStorage, type KeyValueStorage } from "./storage";

const ACTIVE_BREWERY_PREFIX = "brewbruvs.brewery.active.";

function activeBreweryKeyFor(serverUrl: string, userId: string): string {
  const safeUrl = encodeURIComponent(serverUrl).replace(/[^a-zA-Z0-9._-]/g, "_");
  const safeUser = encodeURIComponent(userId).replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${ACTIVE_BREWERY_PREFIX}${safeUrl}.${safeUser}`;
}

export interface BreweryContextValue {
  /** Active brewery id, or null when viewing personal ("Me") workspace. */
  activeBreweryId: string | null;
  /** Resolved active brewery object, or null when in "Me" workspace. */
  activeBrewery: Brewery | null;
  /** All breweries the signed-in user belongs to. */
  breweries: readonly Brewery[];
  /** Breweries where the signed-in user is an owner or brewer. */
  writableBreweries: readonly Brewery[];
  /** True while the brewery list is initially loading. */
  loading: boolean;
  /** Count of pending brewery invites sent to the signed-in user. */
  myInvitesCount: number;
  /** Switches active workspace to "Me" (null) or a brewery id. */
  setActiveBreweryId: (id: string | null) => void;
  /** Looks up a brewery by id from the user's memberships. */
  breweryById: (id: string) => Brewery | undefined;
  /** Returns the signed-in user's role in a brewery, or null if not a member. */
  roleInBrewery: (id: string) => BreweryRole | null;
}

const BreweryContext = createContext<BreweryContextValue | null>(null);

export interface BreweryProviderProps {
  children: ReactNode;
  storage?: KeyValueStorage;
  initialActiveBreweryId?: string | null;
  customFetch?: typeof fetch;
}

export function BreweryProvider({
  children,
  storage = appStorage,
  initialActiveBreweryId,
  customFetch,
}: BreweryProviderProps) {
  const server = useOptionalServer();
  const serverUrl = server?.serverUrl ?? null;
  const authToken = server?.authToken ?? null;
  const currentUser = useCurrentUser(serverUrl, authToken, customFetch);
  const userId = currentUser.data?.id ?? null;
  const signedIn = Boolean(userId);

  const breweriesQuery = useBreweries(serverUrl, authToken, signedIn, customFetch);
  const myInvitesQuery = useMyBreweryInvites(serverUrl, authToken, signedIn, customFetch);

  const [activeBreweryId, setActiveBreweryIdState] = useState<string | null>(
    initialActiveBreweryId ?? null,
  );
  const [hydratedForKey, setHydratedForKey] = useState<string | null>(
    initialActiveBreweryId !== undefined ? "__initial__" : null,
  );

  // Restore saved workspace per (server, user)
  useEffect(() => {
    if (initialActiveBreweryId !== undefined) return;
    if (!serverUrl || !userId) {
      setActiveBreweryIdState(null);
      setHydratedForKey(null);
      return;
    }
    const scopeKey = `${serverUrl}::${userId}`;
    let active = true;
    void storage.getItem(activeBreweryKeyFor(serverUrl, userId)).then((saved) => {
      if (!active) return;
      setActiveBreweryIdState(saved || null);
      setHydratedForKey(scopeKey);
    });
    return () => {
      active = false;
    };
  }, [initialActiveBreweryId, serverUrl, userId, storage]);

  const breweries = useMemo(
    () => (signedIn ? (breweriesQuery.data ?? []) : []),
    [signedIn, breweriesQuery.data],
  );

  // If the selected brewery is no longer in memberships (left, removed, or deleted), reset to "Me".
  useEffect(() => {
    if (!signedIn || !userId || !activeBreweryId) return;
    const scopeKey = `${serverUrl ?? ""}::${userId}`;
    if (hydratedForKey !== scopeKey && initialActiveBreweryId === undefined) return;
    if (!breweriesQuery.isSuccess) return;
    if (!breweries.some((b) => b.id === activeBreweryId)) {
      setActiveBreweryIdState(null);
      if (serverUrl) {
        void storage.removeItem(activeBreweryKeyFor(serverUrl, userId));
      }
    }
  }, [
    signedIn,
    userId,
    activeBreweryId,
    hydratedForKey,
    serverUrl,
    initialActiveBreweryId,
    breweriesQuery.isSuccess,
    breweries,
    storage,
  ]);

  const setActiveBreweryId = useCallback(
    (id: string | null) => {
      setActiveBreweryIdState(id);
      if (!serverUrl || !userId) return;
      const key = activeBreweryKeyFor(serverUrl, userId);
      if (id) {
        void storage.setItem(key, id);
      } else {
        void storage.removeItem(key);
      }
    },
    [serverUrl, userId, storage],
  );

  const activeBrewery = useMemo(
    () => (activeBreweryId ? (breweries.find((b) => b.id === activeBreweryId) ?? null) : null),
    [activeBreweryId, breweries],
  );

  const writableBreweries = useMemo(
    () => breweries.filter((b) => canWriteBrewery(b.role)),
    [breweries],
  );

  const breweryById = useCallback((id: string) => breweries.find((b) => b.id === id), [breweries]);

  const roleInBrewery = useCallback(
    (id: string) => breweries.find((b) => b.id === id)?.role ?? null,
    [breweries],
  );

  const value = useMemo<BreweryContextValue>(
    () => ({
      activeBreweryId: activeBrewery ? activeBrewery.id : null,
      activeBrewery,
      breweries,
      writableBreweries,
      loading: signedIn && breweriesQuery.isPending,
      myInvitesCount: signedIn ? (myInvitesQuery.data?.length ?? 0) : 0,
      setActiveBreweryId,
      breweryById,
      roleInBrewery,
    }),
    [
      activeBrewery,
      breweries,
      writableBreweries,
      signedIn,
      breweriesQuery.isPending,
      myInvitesQuery.data?.length,
      setActiveBreweryId,
      breweryById,
      roleInBrewery,
    ],
  );

  return <BreweryContext.Provider value={value}>{children}</BreweryContext.Provider>;
}

const FALLBACK_BREWERY_CONTEXT: BreweryContextValue = {
  activeBreweryId: null,
  activeBrewery: null,
  breweries: [],
  writableBreweries: [],
  loading: false,
  myInvitesCount: 0,
  setActiveBreweryId: () => {},
  breweryById: () => undefined,
  roleInBrewery: () => null,
};

export function useOptionalBrewery(): BreweryContextValue {
  return useContext(BreweryContext) ?? FALLBACK_BREWERY_CONTEXT;
}

export function useBrewery(): BreweryContextValue {
  const ctx = useContext(BreweryContext);
  if (!ctx) {
    throw new Error("useBrewery must be used within a BreweryProvider");
  }
  return ctx;
}
