// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useCurrentUser } from "../src/api/auth";
import { syncDueRemindersOnOpen } from "../src/notifications";
import { BreweryProvider } from "../src/state/brewery";
import { ServerProvider, useServer } from "../src/state/server";
import { UnitsProvider, useUnits } from "../src/state/units";

const REMINDER_RESYNC_MIN_INTERVAL_MS = 15_000;

function DueReminderSync() {
  const { serverUrl, authToken } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);
  const userId = currentUser.data?.id ?? null;
  const lastSyncRef = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (!serverUrl || !userId) {
      lastSyncRef.current = null;
      return;
    }
    const scopeKey = `${serverUrl}::${userId}`;
    let active = true;

    const runSync = (force: boolean) => {
      const now = Date.now();
      const prev = lastSyncRef.current;
      if (
        !force &&
        prev &&
        prev.key === scopeKey &&
        now - prev.at < REMINDER_RESYNC_MIN_INTERVAL_MS
      ) {
        return;
      }
      lastSyncRef.current = { key: scopeKey, at: now };
      void syncDueRemindersOnOpen({ serverUrl, authToken, userId }).catch(() => {
        // Non-fatal when offline or server is temporarily unreachable.
        if (active && lastSyncRef.current?.key === scopeKey) {
          lastSyncRef.current = null;
        }
      });
    };

    runSync(true);

    let prevState = AppState.currentState;
    const sub = AppState.addEventListener("change", (nextState) => {
      if (prevState !== "active" && nextState === "active") {
        runSync(false);
      }
      prevState = nextState;
    });

    return () => {
      active = false;
      sub.remove();
    };
  }, [serverUrl, authToken, userId]);

  return null;
}

function ServerUnitSync() {
  const { serverUrl, authToken } = useServer();
  const { setUnitSystem } = useUnits();
  const currentUser = useCurrentUser(serverUrl, authToken);
  const lastSynced = useRef<string | null>(null);

  useEffect(() => {
    const user = currentUser.data;
    if (!user) {
      lastSynced.current = null;
      return;
    }
    if (user.units !== "us" && user.units !== "metric") return;
    const key = `${user.id}:${user.units}`;
    if (lastSynced.current !== key) {
      lastSynced.current = key;
      setUnitSystem(user.units);
    }
  }, [currentUser.data, setUnitSystem]);

  return null;
}

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 30_000,
          },
        },
      }),
  );

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <UnitsProvider>
          <ServerProvider>
            <BreweryProvider>
              <ServerUnitSync />
              <DueReminderSync />
              <StatusBar style="dark" />
              <Slot />
            </BreweryProvider>
          </ServerProvider>
        </UnitsProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
