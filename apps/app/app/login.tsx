// SPDX-License-Identifier: AGPL-3.0-or-later
import { Redirect, useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { AUTH_CONTRACT_AVAILABLE } from "../src/api/auth";
import { useServerHealth } from "../src/api/health";
import { AppShell } from "../src/components/AppShell";
import { Banner, Button, Card } from "../src/components/ui";
import { useServer } from "../src/state/server";
import { colors, spacing } from "../src/theme";

export default function LoginScreen() {
  const router = useRouter();
  const { hydrated, serverUrl, disconnectServer } = useServer();
  const health = useServerHealth(serverUrl);

  if (hydrated && !serverUrl) {
    return <Redirect href="/connect" />;
  }

  return (
    <AppShell
      title="Server & Account"
      subtitle="Manage your Brew-Bruvs server connection and sign in."
    >
      <View style={styles.narrowColumn}>
        <Card>
          <Text style={styles.sectionTitle}>Connected Server</Text>
          <Text style={styles.serverUrl} testID="connected-server-url">
            {serverUrl}
          </Text>

          {health.isPending ? (
            <Banner tone="info" message="Checking server health..." testID="server-health-status" />
          ) : health.isError ? (
            <Banner
              tone="error"
              message={
                health.error instanceof Error
                  ? health.error.message
                  : "Server could not be reached. Offline calculators are still available."
              }
              testID="server-health-status"
            />
          ) : health.data?.status === "ok" ? (
            <Banner
              tone="success"
              message="Server is reachable and healthy (/healthz ok)."
              testID="server-health-status"
            />
          ) : null}

          <View style={styles.rowActions}>
            <Button
              label="Switch server"
              variant="secondary"
              onPress={() => router.push("/connect")}
              testID="switch-server-button"
            />
            <Button
              label="Disconnect"
              variant="ghost"
              onPress={() => {
                void disconnectServer().then(() => {
                  router.replace("/connect");
                });
              }}
              testID="disconnect-server-button"
            />
          </View>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Sign In</Text>
          {!AUTH_CONTRACT_AVAILABLE ? (
            <>
              <Banner
                tone="info"
                message="Authentication endpoints land with P0-11. Once merged into @brew-bruvs/api-contract, first-run admin setup and email/password sign-in will appear here."
                testID="auth-pending-banner"
              />
              <Button
                label="Open offline calculators"
                onPress={() => router.push("/calculators")}
                testID="open-calculators-button"
              />
            </>
          ) : null}
        </Card>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  narrowColumn: {
    width: "100%",
    maxWidth: 560,
    gap: spacing.lg,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  serverUrl: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.accentPressed,
  },
  rowActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
});
