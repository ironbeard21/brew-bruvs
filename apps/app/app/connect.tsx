// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useVerifyServer } from "../src/api/health";
import { AppShell } from "../src/components/AppShell";
import { Banner, Button, Card, TextField } from "../src/components/ui";
import { getSuggestedWebServerUrl, useServer } from "../src/state/server";
import { colors, radii, spacing } from "../src/theme";

export default function ConnectScreen() {
  const router = useRouter();
  const { serverUrl, savedServers, selectServer, removeSavedServer, enterOfflineMode } =
    useServer();
  const verifyServer = useVerifyServer();

  const [address, setAddress] = useState(serverUrl ?? getSuggestedWebServerUrl());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (serverUrl && !address) {
      setAddress(serverUrl);
    }
  }, [address, serverUrl]);

  const connectTo = async (target: string) => {
    setErrorMessage(null);
    try {
      const verified = await verifyServer.mutateAsync(target);
      await selectServer(verified.url);
      router.replace("/login");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not connect to that Brew-Bruvs server.",
      );
    }
  };

  const handleUseOffline = async () => {
    await enterOfflineMode();
    router.replace("/calculators");
  };

  return (
    <AppShell
      title="Connect to a Brew-Bruvs Server"
      subtitle="Enter the address of your self-hosted Brew-Bruvs server, or jump straight into offline calculators."
    >
      <View style={styles.narrowColumn}>
        <Card>
          <TextField
            label="Server Address"
            value={address}
            onChangeText={(next) => {
              setAddress(next);
              if (errorMessage) setErrorMessage(null);
            }}
            placeholder="https://brew.example.com"
            helper="Include http:// or https:// (localhost defaults to http://)"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            testID="server-address-input"
            onSubmitEditing={() => {
              void connectTo(address);
            }}
          />

          {errorMessage ? (
            <Banner tone="error" message={errorMessage} testID="connect-error" />
          ) : null}

          <View style={styles.actions}>
            <Button
              label={verifyServer.isPending ? "Connecting..." : "Connect"}
              disabled={verifyServer.isPending}
              onPress={() => {
                void connectTo(address);
              }}
              testID="connect-submit-button"
            />
            <Button
              label="Use calculators offline"
              variant="secondary"
              onPress={() => {
                void handleUseOffline();
              }}
              testID="use-offline-button"
            />
          </View>
        </Card>

        {savedServers.length > 0 ? (
          <Card>
            <Text style={styles.sectionTitle}>Saved Servers</Text>
            <Text style={styles.sectionSubtitle}>
              Switch back to a previously connected Brew-Bruvs server.
            </Text>
            <View style={styles.savedList}>
              {savedServers.map((url) => {
                const isActive = url === serverUrl;
                return (
                  <View key={url} style={styles.savedRow}>
                    <View style={styles.savedMeta}>
                      <Text style={styles.savedUrl} numberOfLines={1}>
                        {url}
                      </Text>
                      {isActive ? <Text style={styles.activeBadge}>Current</Text> : null}
                    </View>
                    <View style={styles.savedButtons}>
                      <Button
                        label={isActive ? "Open" : "Switch"}
                        variant="secondary"
                        disabled={verifyServer.isPending}
                        onPress={() => {
                          setAddress(url);
                          void connectTo(url);
                        }}
                        accessibilityLabel={`Connect to ${url}`}
                      />
                      <Button
                        label="Remove"
                        variant="ghost"
                        onPress={() => {
                          void removeSavedServer(url);
                        }}
                        accessibilityLabel={`Remove saved server ${url}`}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>
        ) : null}

        <Pressable
          onPress={() => router.push("/privacy")}
          accessibilityRole="link"
          accessibilityLabel="Read Brew-Bruvs Privacy Policy"
          testID="connect-privacy-policy-link"
          style={styles.privacyLinkWrap}
        >
          <Text style={styles.privacyLinkText}>
            Privacy Policy — no tracking; your data stays on the server you choose
          </Text>
        </Pressable>
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
  actions: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
  },
  savedList: {
    gap: spacing.sm,
  },
  savedRow: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  savedMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  savedUrl: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  activeBadge: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.success,
  },
  savedButtons: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  privacyLinkWrap: {
    paddingVertical: spacing.xs,
    alignSelf: "flex-start",
  },
  privacyLinkText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.accent,
    textDecorationLine: "underline",
  },
});
