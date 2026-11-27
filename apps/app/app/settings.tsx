// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useCurrentUser } from "../src/api/auth";
import { AppShell } from "../src/components/AppShell";
import { SettingsPanel } from "../src/components/settings/SettingsPanel";
import { Banner, Button, Card } from "../src/components/ui";
import { useServer } from "../src/state/server";
import { spacing } from "../src/theme";

export default function SettingsScreen() {
  const router = useRouter();
  const { serverUrl, authToken } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);

  if (!serverUrl) {
    return (
      <AppShell
        title="Settings"
        subtitle="Connect to a Brew-Bruvs server to manage profile settings and API tokens."
      >
        <Card>
          <Banner
            tone="info"
            message="You are currently in offline mode. Use the US/Metric toggle in the header for local calculator units, or connect to a server to sync settings."
          />
          <View style={styles.actions}>
            <Button label="Connect to server" onPress={() => router.push("/connect")} />
            <Button
              label="About & licenses"
              variant="secondary"
              onPress={() => router.push("/about")}
            />
          </View>
        </Card>
      </AppShell>
    );
  }

  if (currentUser.isPending) {
    return (
      <AppShell title="Settings">
        <Card>
          <Banner tone="info" message="Loading account settings..." />
        </Card>
      </AppShell>
    );
  }

  const user = currentUser.data;
  if (!user) {
    return (
      <AppShell
        title="Settings"
        subtitle="Sign in to manage your profile, password, and API tokens."
      >
        <Card>
          <Banner tone="info" message="Sign in to view and update your account settings." />
          <View style={styles.actions}>
            <Button label="Sign in" onPress={() => router.push("/login")} />
            <Button
              label="About & licenses"
              variant="secondary"
              onPress={() => router.push("/about")}
            />
          </View>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Settings"
      subtitle="Manage your display name, server-synced units preference, password, and personal API tokens."
    >
      <View style={styles.subNav}>
        <Button
          label="Account Settings"
          variant="primary"
          onPress={() => {}}
          testID="subnav-settings"
        />
        <Button
          label="Integrations"
          variant="secondary"
          onPress={() => router.push("/integrations")}
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

      <SettingsPanel serverUrl={serverUrl} authToken={authToken} user={user} />
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
