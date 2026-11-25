// SPDX-License-Identifier: AGPL-3.0-or-later
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useCurrentUser } from "../src/api/auth";
import { type InventoryItem, useShoppingList } from "../src/api/inventory";
import { AppShell } from "../src/components/AppShell";
import { InventoryPanel } from "../src/components/inventory/InventoryPanel";
import { ShoppingListPanel } from "../src/components/inventory/ShoppingListPanel";
import { Banner, Button, Card, SegmentedControl } from "../src/components/ui";
import { useOptionalBrewery } from "../src/state/brewery";
import { useServer } from "../src/state/server";

type InventoryTab = "stock" | "shopping";

export default function InventoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { serverUrl, authToken } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);
  const { activeBrewery, breweries } = useOptionalBrewery();

  const [tab, setTab] = useState<InventoryTab>(params.tab === "shopping" ? "shopping" : "stock");
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

  useEffect(() => {
    if (params.tab === "shopping") {
      setTab("shopping");
    } else if (params.tab === "stock") {
      setTab("stock");
    }
  }, [params.tab]);

  const shoppingQuery = useShoppingList(serverUrl, authToken, {
    breweryId: activeBrewery?.id ?? null,
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
        activeBrewery
          ? `Managing ${activeBrewery.name} inventory, reservations, and shopping list.`
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
          activeBrewery={activeBrewery}
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
          activeBrewery={activeBrewery}
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
