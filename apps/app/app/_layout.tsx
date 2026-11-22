// SPDX-License-Identifier: AGPL-3.0-or-later
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ServerProvider } from "../src/state/server";
import { UnitsProvider } from "../src/state/units";

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
            <StatusBar style="dark" />
            <Slot />
          </ServerProvider>
        </UnitsProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
