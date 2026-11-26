// SPDX-License-Identifier: AGPL-3.0-or-later
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useCurrentUser } from "../src/api/auth";
import { AppShell } from "../src/components/AppShell";
import { BrewfatherPanel } from "../src/components/integrations/BrewfatherPanel";
import { DevicesPanel } from "../src/components/integrations/DevicesPanel";
import { WebhooksPanel } from "../src/components/integrations/WebhooksPanel";
import { Banner, Button, Card, SegmentedControl } from "../src/components/ui";
import { useOptionalBrewery } from "../src/state/brewery";
import { useServer } from "../src/state/server";
import { spacing } from "../src/theme";

type IntegrationTab = "devices" | "webhooks" | "brewfather";

const TAB_OPTIONS: readonly {
  value: IntegrationTab;
  label: string;
  accessibilityLabel: string;
}[] = [
  { value: "devices", label: "Devices", accessibilityLabel: "Hydrometer devices" },
  { value: "webhooks", label: "Webhooks", accessibilityLabel: "Outgoing webhooks" },
  { value: "brewfather", label: "Brewfather", accessibilityLabel: "Brewfather import" },
];

function parseTabParam(raw: string | string[] | undefined): IntegrationTab | null {
  const val = Array.isArray(raw) ? raw[0] : raw;
  if (val === "devices" || val === "webhooks" || val === "brewfather") return val;
  return null;
}

export default function IntegrationsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string; batchId?: string }>();
  const { serverUrl, authToken } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);
  const { breweries, activeBrewery, setActiveBreweryId } = useOptionalBrewery();

  const paramTab = parseTabParam(params.tab);
  const initialBatchId = typeof params.batchId === "string" ? params.batchId : null;
  const [tab, setTab] = useState<IntegrationTab>(paramTab ?? "devices");

  useEffect(() => {
    if (paramTab) {
      setTab(paramTab);
    }
  }, [paramTab]);

  if (!serverUrl) {
    return (
      <AppShell
        title="Integrations"
        subtitle="Connect wireless hydrometers, send outgoing webhooks, or import from Brewfather."
      >
        <Card>
          <Banner
            tone="info"
            message="You are currently in offline mode. Connect to a Brew-Bruvs server to configure devices, webhooks, or Brewfather imports."
          />
          <View style={styles.actions}>
            <Button label="Connect to server" onPress={() => router.push("/connect")} />
          </View>
        </Card>
      </AppShell>
    );
  }

  if (currentUser.isPending) {
    return (
      <AppShell title="Integrations">
        <Card>
          <Banner tone="info" message="Loading integrations..." />
        </Card>
      </AppShell>
    );
  }

  const user = currentUser.data;
  if (!user) {
    return (
      <AppShell
        title="Integrations"
        subtitle="Sign in to connect hydrometer devices, configure webhooks, or import from Brewfather."
      >
        <Card>
          <Banner
            tone="info"
            message="Sign in to manage device upload URLs, outgoing webhooks, and Brewfather imports."
          />
          <View style={styles.actions}>
            <Button label="Sign in" onPress={() => router.push("/login")} />
          </View>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Integrations"
      subtitle="Connect wireless hydrometers (iSpindel, GravityMon, Tilt, RAPT), send signed webhooks, or import from Brewfather."
    >
      <View style={styles.subNav}>
        <Button
          label="Account Settings"
          variant="secondary"
          onPress={() => router.push("/settings")}
          testID="subnav-settings"
        />
        <Button
          label="Integrations"
          variant="primary"
          onPress={() => {}}
          testID="subnav-integrations"
        />
        {user.isAdmin ? (
          <Button
            label="Server Admin"
            variant="secondary"
            onPress={() => router.push("/admin")}
            testID="subnav-admin"
          />
        ) : null}
        <Button
          label="About & Licenses"
          variant="secondary"
          onPress={() => router.push("/about")}
          testID="subnav-about"
        />
      </View>

      <SegmentedControl
        options={TAB_OPTIONS}
        value={tab}
        onChange={setTab}
        accessibilityLabel="Integration sections"
      />

      {tab === "devices" ? (
        <DevicesPanel
          serverUrl={serverUrl}
          authToken={authToken}
          currentUserId={user.id}
          breweries={breweries}
          initialBatchId={initialBatchId}
          onOpenBatch={(id) => router.push(`/batches/${id}`)}
          onCreateBatch={() => router.push("/batches/new")}
        />
      ) : null}

      {tab === "webhooks" ? (
        <WebhooksPanel
          serverUrl={serverUrl}
          authToken={authToken}
          currentUserId={user.id}
          activeBrewery={activeBrewery}
          onSwitchToPersonal={() => setActiveBreweryId(null)}
        />
      ) : null}

      {tab === "brewfather" ? (
        <BrewfatherPanel
          serverUrl={serverUrl}
          authToken={authToken}
          activeBrewery={activeBrewery}
          onOpenRecipes={() => router.push("/recipes")}
          onOpenBatches={() => router.push("/batches")}
          onOpenInventory={() => router.push("/inventory")}
        />
      ) : null}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  subNav: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
});
