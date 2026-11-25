// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useCurrentUser } from "../src/api/auth";
import { BreweryProvider } from "../src/state/brewery";
import { ServerProvider, useServer } from "../src/state/server";
import { UnitsProvider, useUnits } from "../src/state/units";

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
              <StatusBar style="dark" />
              <Slot />
            </BreweryProvider>
          </ServerProvider>
        </UnitsProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
