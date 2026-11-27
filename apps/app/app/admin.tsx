// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useCurrentUser } from "../src/api/auth";
import { AppShell } from "../src/components/AppShell";
import { AdminPanel } from "../src/components/settings/AdminPanel";
import { Banner, Button, Card } from "../src/components/ui";
import { useServer } from "../src/state/server";
import { spacing } from "../src/theme";

export default function AdminScreen() {
  const router = useRouter();
  const { serverUrl, authToken } = useServer();
  const currentUser = useCurrentUser(serverUrl, authToken);

  if (!serverUrl) {
    return (
      <AppShell title="Server Admin">
        <Card>
          <Banner tone="info" message="Connect to a Brew-Bruvs server to open server admin." />
          <Button label="Connect to server" onPress={() => router.push("/connect")} />
        </Card>
      </AppShell>
    );
  }

  if (currentUser.isPending) {
    return (
      <AppShell title="Server Admin">
        <Card>
          <Banner tone="info" message="Checking administrator session..." />
        </Card>
      </AppShell>
    );
  }

  const user = currentUser.data;
  if (!user) {
    return (
      <AppShell title="Server Admin">
        <Card>
          <Banner tone="info" message="Sign in as an administrator to manage this server." />
          <Button label="Sign in" onPress={() => router.push("/login")} />
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Server Admin"
      subtitle="Manage sign-up invites, user accounts, and one-time password reset links."
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
          variant="secondary"
          onPress={() => router.push("/integrations")}
          testID="subnav-integrations"
        />
        <Button label="Server Admin" variant="primary" onPress={() => {}} testID="subnav-admin" />
        <Button
          label="About & Licenses"
          variant="secondary"
          onPress={() => router.push("/about")}
          testID="subnav-about"
        />
      </View>

      <AdminPanel serverUrl={serverUrl} authToken={authToken} currentUser={user} />
    </AppShell>
  );
}

const styles = StyleSheet.create({
  subNav: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
});
