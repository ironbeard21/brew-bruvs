// SPDX-License-Identifier: AGPL-3.0-or-later
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useCurrentUser } from "../src/api/auth";
import { type InventoryItem, useShoppingList } from "../src/api/inventory";
import { AppShell } from "../src/components/AppShell";
import { InventoryPanel } from "../src/components/inventory/InventoryPanel";
import {
  type InventoryTab,
  resolveInventoryBrewery,
} from "../src/components/inventory/inventoryScope";
import { ShoppingListPanel } from "../src/components/inventory/ShoppingListPanel";
import { Banner, Button, Card, SegmentedControl } from "../src/components/ui";
import { useOptionalBrewery } from "../src/state/brewery";
import { useServer } from "../src/state/server";

export default function InventoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string; breweryId?: string; scope?: string }>();
  const { serverUrl, authToken } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);
  const { activeBrewery, activeBreweryId, breweries, setActiveBreweryId } = useOptionalBrewery();

  const paramBreweryId = typeof params.breweryId === "string" ? params.breweryId : undefined;
  const paramScope = typeof params.scope === "string" ? params.scope : undefined;
  const routeScopeKey = paramBreweryId
    ? `brewery:${paramBreweryId}`
    : paramScope === "me"
      ? "me"
      : "";

  const [tab, setTab] = useState<InventoryTab>(params.tab === "shopping" ? "shopping" : "stock");
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [routeOverrideKey, setRouteOverrideKey] = useState<string>(routeScopeKey);
  const appliedScopeRef = useRef<string>("");
  const prevActiveIdRef = useRef<string | null>(activeBreweryId);

  useEffect(() => {
    if (params.tab === "shopping") {
      setTab("shopping");
    } else if (params.tab === "stock") {
      setTab("stock");
    }
  }, [params.tab]);

  // Apply explicit batch-owner scope param once on navigation arrival so the workspace switcher and
  // inventory queries stay in sync with the batch's owner without fighting later manual switches.
  useEffect(() => {
    if (!routeScopeKey || appliedScopeRef.current === routeScopeKey) return;
    if (paramScope === "me") {
      appliedScopeRef.current = routeScopeKey;
      setRouteOverrideKey(routeScopeKey);
      if (activeBreweryId !== null) setActiveBreweryId(null);
      return;
    }
    if (paramBreweryId && breweries.some((b) => b.id === paramBreweryId)) {
      appliedScopeRef.current = routeScopeKey;
      setRouteOverrideKey(routeScopeKey);
      if (activeBreweryId !== paramBreweryId) setActiveBreweryId(paramBreweryId);
    }
  }, [routeScopeKey, paramScope, paramBreweryId, breweries, activeBreweryId, setActiveBreweryId]);

  // Once the user switches workspaces manually in WorkspaceSwitcher, stop applying the arrived param override.
  useEffect(() => {
    if (prevActiveIdRef.current !== activeBreweryId) {
      prevActiveIdRef.current = activeBreweryId;
      const expectedId = paramScope === "me" ? null : (paramBreweryId ?? null);
      if (routeOverrideKey && activeBreweryId !== expectedId) {
        setRouteOverrideKey("");
      }
    }
  }, [activeBreweryId, paramScope, paramBreweryId, routeOverrideKey]);

  const effectiveBrewery = resolveInventoryBrewery({
    activeBrewery,
    breweries,
    paramBreweryId,
    paramScope,
    routeOverrideActive: Boolean(routeOverrideKey && routeOverrideKey === routeScopeKey),
  });

  const shoppingQuery = useShoppingList(serverUrl, authToken, {
    breweryId: effectiveBrewery?.id ?? null,
    enabled: Boolean(serverUrl && currentUser.data),
  });
  const shoppingCount =
    (shoppingQuery.data?.short.length ?? 0) + (shoppingQuery.data?.lowStock.length ?? 0);

  if (!serverUrl) {
    return (
      <AppShell
        title="Inventory & Shopping List"
        subtitle="Connect to a Brew-Bruvs server to track ingredients, reservations, and shopping lists."
      >
        <Card>
          <Banner
            tone="info"
            message="You are currently in offline mode. Connect to a Brew-Bruvs server to manage inventory and shopping lists."
          />
          <Button label="Connect to server" onPress={() => router.push("/connect")} />
        </Card>
      </AppShell>
    );
  }

  if (currentUser.isPending) {
    return (
      <AppShell title="Inventory & Shopping List">
        <Card>
          <Banner tone="info" message="Checking your session..." />
        </Card>
      </AppShell>
    );
  }

  if (!currentUser.data) {
    return (
      <AppShell
        title="Inventory & Shopping List"
        subtitle="Sign in to track ingredients on hand, reservations, and shopping shortfalls."
      >
        <Card>
          <Banner
            tone="info"
            message="Sign in on your connected server to access your inventory and shopping list."
          />
          <Button label="Sign in" onPress={() => router.push("/login")} />
        </Card>
      </AppShell>
    );
  }

  const tabOptions: readonly { value: InventoryTab; label: string; accessibilityLabel: string }[] =
    [
      { value: "stock", label: "Inventory", accessibilityLabel: "Inventory items on hand" },
      {
        value: "shopping",
        label: shoppingCount > 0 ? `Shopping List (${shoppingCount})` : "Shopping List",
        accessibilityLabel: "Shopping list and low-stock items",
      },
    ];

  return (
    <AppShell
      title="Inventory"
      subtitle={
        effectiveBrewery
          ? `Managing ${effectiveBrewery.name} inventory, reservations, and shopping list.`
          : "Track ingredients in your units, reserve stock for batches, and watch low-stock alerts."
      }
    >
      <SegmentedControl
        options={tabOptions}
        value={tab}
        onChange={setTab}
        accessibilityLabel="Inventory sections"
      />

      {tab === "stock" ? (
        <InventoryPanel
          serverUrl={serverUrl}
          authToken={authToken}
          currentUserId={currentUser.data.id}
          activeBrewery={effectiveBrewery}
          breweries={breweries}
          editingItem={editingItem}
          onEditingItemChange={setEditingItem}
          onOpenShoppingList={() => setTab("shopping")}
        />
      ) : (
        <ShoppingListPanel
          serverUrl={serverUrl}
          authToken={authToken}
          currentUserId={currentUser.data.id}
          activeBrewery={effectiveBrewery}
          breweries={breweries}
          onOpenBatch={(batchId) => router.push(`/batches/${batchId}`)}
          onRestockItem={(item) => {
            setEditingItem(item);
            setTab("stock");
          }}
        />
      )}
    </AppShell>
  );
}
