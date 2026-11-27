// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useRedeemPasswordReset } from "../src/api/auth";
import { AppShell } from "../src/components/AppShell";
import { Banner, Button, Card, TextField } from "../src/components/ui";
import { useServer } from "../src/state/server";
import { useThemedStyles } from "../src/state/theme";
import type { ThemeColors } from "../src/theme";

function extractHashToken(): string {
  if (Platform.OS !== "web" || typeof window === "undefined") return "";
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  return params.get("token") ?? "";
}

export default function ResetPasswordScreen() {
  const styles = useThemedStyles(createStyles);
  const router = useRouter();
  const { serverUrl } = useServer();
  const redeemMutation = useRedeemPasswordReset(serverUrl);

  const [token, setToken] = useState(extractHashToken);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const found = extractHashToken();
    if (found) setToken(found);
  }, []);

  const handleSubmit = async () => {
    setError(null);
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setError("Paste the reset token from your admin's link.");
      return;
    }
    if (password.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    try {
      await redeemMutation.mutateAsync({ token: trimmedToken, password });
      setDone(true);
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password.");
    }
  };

  if (!serverUrl) {
    return (
      <AppShell title="Reset Password">
        <Card>
          <Banner tone="info" message="Connect to your Brew-Bruvs server first." />
          <Button label="Connect to server" onPress={() => router.push("/connect")} />
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Reset Password"
      subtitle="Set a new password using a one-time reset link from your server admin."
    >
      <View style={styles.narrow}>
        <Card>
          <Text style={styles.title}>Choose a New Password</Text>
          {done ? (
            <>
              <Banner
                tone="success"
                message="Your password has been updated and all previous sessions were signed out."
                testID="reset-password-success"
              />
              <Button label="Sign in with new password" onPress={() => router.replace("/login")} />
            </>
          ) : (
            <>
              <TextField
                label="Reset Token"
                value={token}
                onChangeText={setToken}
                placeholder="Paste reset token"
                testID="reset-token-input"
              />
              <TextField
                label="New Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="At least 8 characters"
                testID="reset-password-input"
              />
              <TextField
                label="Confirm New Password"
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                placeholder="Re-enter new password"
                testID="reset-confirm-input"
              />
              {error ? <Banner tone="error" message={error} testID="reset-error" /> : null}
              <Button
                label={redeemMutation.isPending ? "Resetting..." : "Reset password"}
                disabled={redeemMutation.isPending}
                onPress={() => void handleSubmit()}
                testID="reset-submit-button"
              />
            </>
          )}
        </Card>
      </View>
    </AppShell>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    narrow: { width: "100%", maxWidth: 520 },
    title: { fontSize: 18, fontWeight: "700", color: colors.text },
  });
