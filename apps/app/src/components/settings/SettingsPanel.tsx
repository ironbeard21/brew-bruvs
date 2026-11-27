// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { Platform, Share, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  type AuthUser,
  type NewUserToken,
  type TokenScope,
  useAuthTokens,
  useChangePassword,
  useCreateApiToken,
  useRevokeApiToken,
  useUpdateMe,
} from "../../api/auth";
import { useThemedStyles } from "../../state/theme";
import { type UnitSystem, useUnits } from "../../state/units";
import { DESKTOP_BREAKPOINT, radii, spacing, type ThemeColors } from "../../theme";
import { formatDateTime } from "../batches/batchFlows";
import { Banner, Button, Card, SegmentedControl, TextField } from "../ui";

export interface SettingsPanelProps {
  serverUrl: string;
  authToken: string | null;
  user: AuthUser;
  customFetch?: typeof fetch;
}

const UNIT_OPTIONS: readonly { value: UnitSystem; label: string; accessibilityLabel: string }[] = [
  { value: "us", label: "US (gal, lb, oz, °F)", accessibilityLabel: "US customary units" },
  { value: "metric", label: "Metric (L, kg, g, °C)", accessibilityLabel: "Metric SI units" },
];

type ScopePreset = "read_write" | "read";

const SCOPE_OPTIONS: readonly { value: ScopePreset; label: string }[] = [
  { value: "read_write", label: "Read & Write" },
  { value: "read", label: "Read-only" },
];

async function copyOrShare(label: string, value: string): Promise<string> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return `${label} copied to clipboard.`;
    } catch {
      return `Select and copy the ${label.toLowerCase()} above.`;
    }
  }
  try {
    await Share.share({ title: label, message: value });
    return `${label} shared.`;
  } catch {
    return `Copy the ${label.toLowerCase()} above.`;
  }
}

export function SettingsPanel({ serverUrl, authToken, user, customFetch }: SettingsPanelProps) {
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const { unitSystem, setUnitSystem } = useUnits();

  // Profile & units
  const [displayName, setDisplayName] = useState(user.displayName);
  const [selectedUnits, setSelectedUnits] = useState<UnitSystem>(user.units);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Sync local form if user changes externally (e.g. header unit toggle)
  useEffect(() => {
    setDisplayName(user.displayName);
    setSelectedUnits(user.units);
  }, [user.displayName, user.units]);

  useEffect(() => {
    setSelectedUnits(unitSystem);
  }, [unitSystem]);

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Personal API tokens
  const [tokenName, setTokenName] = useState("");
  const [scopePreset, setScopePreset] = useState<ScopePreset>("read_write");
  const [createdToken, setCreatedToken] = useState<NewUserToken | null>(null);
  const [tokenNotice, setTokenNotice] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const updateMe = useUpdateMe(serverUrl, authToken, customFetch);
  const changePassword = useChangePassword(serverUrl, authToken, customFetch);
  const tokensQuery = useAuthTokens(serverUrl, authToken, true, customFetch);
  const createToken = useCreateApiToken(serverUrl, authToken, customFetch);
  const revokeToken = useRevokeApiToken(serverUrl, authToken, customFetch);

  const handleSaveProfile = async () => {
    setProfileNotice(null);
    setProfileError(null);
    const trimmed = displayName.trim();
    if (!trimmed) {
      setProfileError("Display name cannot be empty.");
      return;
    }
    try {
      const updated = await updateMe.mutateAsync({
        displayName: trimmed,
        units: selectedUnits,
      });
      setUnitSystem(updated.units);
      setProfileNotice("Profile and units preference saved to server.");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Could not save profile.");
    }
  };

  const handleChangePassword = async () => {
    setPasswordNotice(null);
    setPasswordError(null);
    if (!currentPassword) {
      setPasswordError("Enter your current password.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordNotice("Password updated. Your other sessions and apps were signed out.");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Could not change password.");
    }
  };

  const handleCreateToken = async () => {
    setTokenNotice(null);
    setTokenError(null);
    const trimmed = tokenName.trim();
    if (!trimmed) {
      setTokenError("Enter a descriptive name for the API token.");
      return;
    }
    const scopes: TokenScope[] = scopePreset === "read" ? ["read"] : ["read", "write"];
    try {
      const created = await createToken.mutateAsync({ name: trimmed, scopes });
      setCreatedToken(created);
      setTokenName("");
      setTokenNotice("Personal API token created. Copy it now — it will not be shown again.");
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : "Could not create API token.");
    }
  };

  const handleRevokeToken = async (id: string) => {
    setTokenError(null);
    setTokenNotice(null);
    try {
      await revokeToken.mutateAsync(id);
      if (createdToken?.id === id) {
        setCreatedToken(null);
      }
      setTokenNotice("Token revoked.");
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : "Could not revoke token.");
    }
  };

  const tokens = tokensQuery.data ?? [];

  return (
    <View style={styles.root} testID="settings-panel">
      <View style={[styles.row, isDesktop && styles.rowDesktop]}>
        {/* Profile & Units */}
        <Card style={isDesktop ? styles.column : undefined}>
          <Text style={styles.sectionTitle}>Profile & Units</Text>
          <Text style={styles.muted}>
            Signed in as {user.email}. All measurements are stored in SI on the server and converted
            to your preferred display units.
          </Text>

          <TextField
            label="Display Name"
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
            placeholder="Head Brewer"
            testID="settings-display-name-input"
          />

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Preferred Display Units (synced to server)</Text>
            <SegmentedControl
              options={UNIT_OPTIONS}
              value={selectedUnits}
              onChange={setSelectedUnits}
              accessibilityLabel="Preferred display units"
            />
          </View>

          {profileNotice ? (
            <Banner tone="success" message={profileNotice} testID="settings-profile-saved" />
          ) : null}
          {profileError ? (
            <Banner tone="error" message={profileError} testID="settings-profile-error" />
          ) : null}

          <Button
            label={updateMe.isPending ? "Saving..." : "Save profile & units"}
            disabled={updateMe.isPending}
            onPress={() => void handleSaveProfile()}
            testID="settings-save-profile-button"
          />
        </Card>

        {/* Change Password */}
        <Card style={isDesktop ? styles.column : undefined}>
          <Text style={styles.sectionTitle}>Change Password</Text>
          <Text style={styles.muted}>
            Changing your password signs out your other browsers and mobile sessions while keeping
            this session active.
          </Text>

          <TextField
            label="Current Password"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            placeholder="Current password"
            testID="settings-current-password-input"
          />

          <TextField
            label="New Password"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            placeholder="At least 8 characters"
            testID="settings-new-password-input"
          />

          <TextField
            label="Confirm New Password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            placeholder="Re-enter new password"
            testID="settings-confirm-password-input"
          />

          {passwordNotice ? (
            <Banner tone="success" message={passwordNotice} testID="settings-password-saved" />
          ) : null}
          {passwordError ? (
            <Banner tone="error" message={passwordError} testID="settings-password-error" />
          ) : null}

          <Button
            label={changePassword.isPending ? "Updating..." : "Update password"}
            variant="secondary"
            disabled={changePassword.isPending}
            onPress={() => void handleChangePassword()}
            testID="settings-change-password-button"
          />
        </Card>
      </View>

      {/* Personal API Tokens */}
      <Card>
        <Text style={styles.sectionTitle}>Personal API Tokens</Text>
        <Text style={styles.muted}>
          Use personal tokens for scripts, hydrometer integrations, or CLI automation via{" "}
          Authorization: Bearer headers.
        </Text>

        <View style={[styles.tokenFormRow, isDesktop && styles.tokenFormRowDesktop]}>
          <View style={isDesktop ? styles.tokenNameCol : undefined}>
            <TextField
              label="Token Name"
              value={tokenName}
              onChangeText={setTokenName}
              placeholder="e.g. Tilt Bridge, Backup Script"
              testID="token-name-input"
            />
          </View>
          <View style={isDesktop ? styles.tokenScopeCol : undefined}>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Scopes</Text>
              <SegmentedControl
                options={SCOPE_OPTIONS}
                value={scopePreset}
                onChange={setScopePreset}
                accessibilityLabel="Token permission scope"
                compact
              />
            </View>
          </View>
        </View>

        <Button
          label={createToken.isPending ? "Creating..." : "Create personal API token"}
          disabled={createToken.isPending}
          onPress={() => void handleCreateToken()}
          testID="token-create-button"
        />

        {createdToken ? (
          <View style={styles.secretBox} testID="new-token-secret">
            <Text style={styles.secretTitle}>New Token Secret (shown once)</Text>
            <Text selectable style={styles.secretValue} testID="new-token-value">
              {createdToken.token}
            </Text>
            <View style={styles.secretActions}>
              <Button
                label="Copy token"
                variant="secondary"
                onPress={() => {
                  void copyOrShare("API token", createdToken.token).then(setTokenNotice);
                }}
                testID="copy-new-token-button"
              />
              <Button label="Dismiss" variant="ghost" onPress={() => setCreatedToken(null)} />
            </View>
          </View>
        ) : null}

        {tokenNotice ? <Banner tone="success" message={tokenNotice} testID="token-notice" /> : null}
        {tokenError ? <Banner tone="error" message={tokenError} testID="token-error" /> : null}

        <Text style={styles.subHeading}>Active Tokens ({tokens.length})</Text>
        {tokensQuery.isPending ? (
          <Banner tone="info" message="Loading tokens..." />
        ) : tokensQuery.isError ? (
          <Banner tone="error" message="Could not load active tokens." />
        ) : tokens.length === 0 ? (
          <Text style={styles.muted}>No active tokens found.</Text>
        ) : (
          <View style={styles.list}>
            {tokens.map((tok) => (
              <View key={tok.id} style={styles.tokenRow} testID={`token-row-${tok.id}`}>
                <View style={styles.tokenMeta}>
                  <View style={styles.badgeRow}>
                    <Text style={styles.tokenTitle}>{tok.name || "Unnamed session"}</Text>
                    <View style={styles.kindBadge}>
                      <Text style={styles.kindBadgeText}>{tok.kind}</Text>
                    </View>
                    {tok.scopes.length > 0 ? (
                      <Text style={styles.scopeText}>{tok.scopes.join(", ")}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.mutedSmall}>
                    Created {formatDateTime(tok.createdAt)}
                    {tok.lastUsedAt ? ` · Last used ${formatDateTime(tok.lastUsedAt)}` : ""}
                  </Text>
                </View>
                <Button
                  label="Revoke"
                  variant="ghost"
                  disabled={revokeToken.isPending}
                  onPress={() => void handleRevokeToken(tok.id)}
                  testID={`token-revoke-${tok.id}`}
                />
              </View>
            ))}
          </View>
        )}
      </Card>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { gap: spacing.lg },
    row: { gap: spacing.lg },
    rowDesktop: { flexDirection: "row", alignItems: "flex-start" },
    column: { flex: 1 },
    sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
    subHeading: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: spacing.xs },
    muted: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
    mutedSmall: { fontSize: 12, color: colors.textMuted },
    fieldGroup: { gap: spacing.xs },
    fieldLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
    tokenFormRow: { gap: spacing.md },
    tokenFormRowDesktop: { flexDirection: "row", alignItems: "flex-end" },
    tokenNameCol: { flex: 2 },
    tokenScopeCol: { flex: 1 },
    secretBox: {
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accent,
      gap: spacing.sm,
    },
    secretTitle: { fontSize: 13, fontWeight: "700", color: colors.accentPressed },
    secretValue: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.text,
      padding: spacing.sm,
      borderRadius: radii.sm,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    secretActions: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
    list: { gap: spacing.sm },
    tokenRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap",
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tokenMeta: { flex: 1, minWidth: 180, gap: 4 },
    badgeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
    tokenTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
    kindBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radii.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    kindBadgeText: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.textMuted,
      textTransform: "uppercase",
    },
    scopeText: { fontSize: 12, fontWeight: "600", color: colors.accentPressed },
  });
