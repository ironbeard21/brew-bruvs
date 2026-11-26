// SPDX-License-Identifier: AGPL-3.0-or-later
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useCurrentUser } from "../src/api/auth";
import { AppShell } from "../src/components/AppShell";
import { EquipmentPanel } from "../src/components/equipment/EquipmentPanel";
import { resolveInventoryBrewery } from "../src/components/inventory/inventoryScope";
import { Banner, Button, Card } from "../src/components/ui";
import { useOptionalBrewery } from "../src/state/brewery";
import { useServer } from "../src/state/server";

export default function EquipmentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ breweryId?: string }>();
  const { serverUrl, authToken } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);
  const { activeBrewery, activeBreweryId, breweries, setActiveBreweryId } = useOptionalBrewery();

  const paramBreweryId = typeof params.breweryId === "string" ? params.breweryId : undefined;
  const [routeOverrideActive, setRouteOverrideActive] = useState(Boolean(paramBreweryId));
  const lastRouteParamRef = useRef<string | undefined>(paramBreweryId);
  const lastActiveBreweryRef = useRef(activeBreweryId);

  useEffect(() => {
    if (lastRouteParamRef.current !== paramBreweryId) {
      lastRouteParamRef.current = paramBreweryId;
      setRouteOverrideActive(Boolean(paramBreweryId));
    }
  }, [paramBreweryId]);

  useEffect(() => {
    if (lastActiveBreweryRef.current !== activeBreweryId) {
      lastActiveBreweryRef.current = activeBreweryId;
      setRouteOverrideActive(false);
    }
  }, [activeBreweryId]);

  useEffect(() => {
    if (!routeOverrideActive || !paramBreweryId) return;
    if (breweries.some((b) => b.id === paramBreweryId) && activeBreweryId !== paramBreweryId) {
      setActiveBreweryId(paramBreweryId);
    }
  }, [routeOverrideActive, paramBreweryId, breweries, activeBreweryId, setActiveBreweryId]);

  const effectiveBrewery = resolveInventoryBrewery({
    activeBrewery,
    breweries,
    paramBreweryId,
    routeOverrideActive,
  });

  if (!serverUrl) {
    return (
      <AppShell
        title="Equipment"
        subtitle="Track personal and brewery brewing gear, conditions, specs, and club lending."
      >
        <Card>
          <Banner
            tone="info"
            message="You are currently in offline mode. Connect to a Brew-Bruvs server to manage equipment."
          />
          <Button
            label="Connect to server"
            onPress={() => router.push("/connect")}
            testID="equipment-connect-button"
          />
        </Card>
      </AppShell>
    );
  }

  if (currentUser.isPending) {
    return (
      <AppShell title="Equipment">
        <Card>
          <Banner tone="info" message="Loading account..." />
        </Card>
      </AppShell>
    );
  }

  if (!currentUser.data) {
    return (
      <AppShell
        title="Equipment"
        subtitle="Sign in to track kettles, fermenters, chillers, and brewery gear loans."
      >
        <Card>
          <Banner tone="info" message="Sign in to view and manage equipment." />
          <Button
            label="Sign in"
            onPress={() => router.push("/login")}
            testID="equipment-signin-button"
          />
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Equipment"
      subtitle={
        effectiveBrewery
          ? `${effectiveBrewery.name} — track gear, who holds lent items, and sharing.`
          : "Personal & shared gear — track kettles, fermenters, conditions, and brewery lending."
      }
    >
      <EquipmentPanel
        serverUrl={serverUrl}
        authToken={authToken}
        currentUserId={currentUser.data.id}
        activeBrewery={effectiveBrewery}
        breweries={breweries}
      />
    </AppShell>
  );
}
