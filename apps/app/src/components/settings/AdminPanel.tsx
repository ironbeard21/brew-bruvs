// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { Platform, Share, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  type AuthUser,
  type Invite,
  type PasswordResetLink,
  useAdminUsers,
  useAuthStatus,
  useCreateInvite,
  useCreatePasswordResetLink,
  useSetUserDisabled,
} from "../../api/auth";
import { colors, DESKTOP_BREAKPOINT, radii, spacing } from "../../theme";
import { formatDateTime } from "../batches/batchFlows";
import { Banner, Button, Card, ResultRow } from "../ui";

export interface AdminPanelProps {
  serverUrl: string;
  authToken: string | null;
  currentUser: AuthUser;
  customFetch?: typeof fetch;
}

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

export function AdminPanel({ serverUrl, authToken, currentUser, customFetch }: AdminPanelProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const authStatus = useAuthStatus(serverUrl, customFetch);
  const usersQuery = useAdminUsers(serverUrl, authToken, currentUser.isAdmin, customFetch);
  const createInviteMutation = useCreateInvite(serverUrl, authToken, customFetch);
  const setDisabledMutation = useSetUserDisabled(serverUrl, authToken, customFetch);
  const createResetMutation = useCreatePasswordResetLink(serverUrl, authToken, customFetch);

  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [activeReset, setActiveReset] = useState<{
    userEmail: string;
    link: PasswordResetLink;
  } | null>(null);
  const [userNotice, setUserNotice] = useState<string | null>(null);
  const [userError, setUserError] = useState<string | null>(null);

  if (!currentUser.isAdmin) {
    return (
      <Card>
        <Text style={styles.sectionTitle}>Admin Access Required</Text>
        <Banner
          tone="error"
          message="Only server administrators can manage invites, accounts, and password reset links."
        />
      </Card>
    );
  }

  const handleCreateInvite = async () => {
    setInviteError(null);
    setInviteNotice(null);
    try {
      const invite = await createInviteMutation.mutateAsync();
      setInvites((prev) => [invite, ...prev]);
      setInviteNotice("One-time invite code created.");
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not create invite.");
    }
  };

  const handleToggleDisable = async (userId: string, currentlyDisabled: boolean) => {
    setUserError(null);
    setUserNotice(null);
    try {
      const updated = await setDisabledMutation.mutateAsync({
        userId,
        disabled: !currentlyDisabled,
      });
      setUserNotice(
        updated.disabled
          ? `Disabled ${updated.email} and revoked all active tokens.`
          : `Re-enabled ${updated.email}.`,
      );
    } catch (err) {
      setUserError(err instanceof Error ? err.message : "Could not update user status.");
    }
  };

  const handleCreateResetLink = async (userId: string, userEmail: string) => {
    setUserError(null);
    setUserNotice(null);
    try {
      const link = await createResetMutation.mutateAsync(userId);
      setActiveReset({ userEmail, link });
      setUserNotice(`One-time password reset link created for ${userEmail}.`);
    } catch (err) {
      setUserError(err instanceof Error ? err.message : "Could not create password reset link.");
    }
  };

  const signupMode = authStatus.data?.signupMode;
  const users = usersQuery.data ?? [];

  return (
    <View style={styles.root} testID="admin-panel">
      <View style={[styles.row, isDesktop && styles.rowDesktop]}>
        {/* Server Sign-up Mode */}
        <Card style={isDesktop ? styles.column : undefined}>
          <Text style={styles.sectionTitle}>Server Access & Sign-Up Mode</Text>
          <Text style={styles.muted}>
            Sign-up mode is configured via the server&apos;s SIGNUP_MODE environment variable.
          </Text>

          {authStatus.isPending ? (
            <Banner tone="info" message="Loading server sign-in settings..." />
          ) : authStatus.data ? (
            <View style={styles.metrics}>
              <ResultRow
                label="Sign-Up Mode"
                value={signupMode === "open" ? "Open" : "Invite-only"}
                subtitle={
                  signupMode === "open"
                    ? "Anyone with the server URL can register an account"
                    : "New accounts require a one-time invite code"
                }
                highlight
                testID="admin-signup-mode"
              />
              <ResultRow
                label="Single Sign-On (OIDC)"
                value={authStatus.data.oidcEnabled ? "Enabled" : "Not configured"}
                testID="admin-oidc-status"
              />
            </View>
          ) : (
            <Banner tone="error" message="Could not load server access settings." />
          )}
        </Card>

        {/* Invites */}
        <Card style={isDesktop ? styles.column : undefined}>
          <Text style={styles.sectionTitle}>One-Time Invites</Text>
          <Text style={styles.muted}>
            Generate a single-use invite code to share with a friend or club member so they can
            create an account on this server.
          </Text>

          <Button
            label={createInviteMutation.isPending ? "Creating..." : "Create invite code"}
            disabled={createInviteMutation.isPending}
            onPress={() => void handleCreateInvite()}
            testID="admin-create-invite-button"
          />

          {inviteNotice ? <Banner tone="success" message={inviteNotice} /> : null}
          {inviteError ? <Banner tone="error" message={inviteError} /> : null}

          {invites.length > 0 ? (
            <View style={styles.list}>
              {invites.map((inv, idx) => (
                <View key={inv.code} style={styles.calloutBox}>
                  <Text style={styles.calloutLabel}>Invite Code {idx === 0 ? "(Latest)" : ""}</Text>
                  <Text
                    selectable
                    style={styles.calloutValue}
                    testID={idx === 0 ? "admin-invite-code" : `admin-invite-code-${idx}`}
                  >
                    {inv.code}
                  </Text>
                  <Text style={styles.mutedSmall}>Expires {formatDateTime(inv.expiresAt)}</Text>
                  <View style={styles.inlineActions}>
                    <Button
                      label="Copy code"
                      variant="secondary"
                      onPress={() => {
                        void copyOrShare("Invite code", inv.code).then(setInviteNotice);
                      }}
                    />
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      </View>

      {/* Users Management */}
      <Card>
        <Text style={styles.sectionTitle}>Server Accounts ({users.length})</Text>
        <Text style={styles.muted}>
          Disable accounts to revoke all their sessions and tokens, or generate a one-time password
          reset link (valid 24 hours; no email server required).
        </Text>

        {activeReset ? (
          <View style={styles.calloutBox} testID="admin-reset-link-box">
            <Text style={styles.calloutLabel}>
              One-Time Password Reset Link for {activeReset.userEmail}
            </Text>
            <Text selectable style={styles.calloutValue} testID="admin-reset-link-value">
              {activeReset.link.url}
            </Text>
            <Text style={styles.mutedSmall}>
              Expires {formatDateTime(activeReset.link.expiresAt)} · Token sits after # so it stays
              out of server logs.
            </Text>
            <View style={styles.inlineActions}>
              <Button
                label="Copy reset link"
                variant="secondary"
                onPress={() => {
                  void copyOrShare("Password reset link", activeReset.link.url).then(setUserNotice);
                }}
              />
              <Button label="Dismiss" variant="ghost" onPress={() => setActiveReset(null)} />
            </View>
          </View>
        ) : null}

        {userNotice ? (
          <Banner tone="success" message={userNotice} testID="admin-user-notice" />
        ) : null}
        {userError ? <Banner tone="error" message={userError} testID="admin-user-error" /> : null}

        {usersQuery.isPending ? (
          <Banner tone="info" message="Loading accounts..." />
        ) : usersQuery.isError ? (
          <Banner tone="error" message="Could not load server accounts." />
        ) : (
          <View style={styles.list}>
            {users.map((u) => {
              const isSelf = u.id === currentUser.id;
              return (
                <View key={u.id} style={styles.userRow} testID={`admin-user-row-${u.id}`}>
                  <View style={styles.userInfo}>
                    <View style={styles.badgeRow}>
                      <Text style={styles.userName}>{u.displayName}</Text>
                      {u.isAdmin ? (
                        <View style={styles.adminPill}>
                          <Text style={styles.adminPillText}>Admin</Text>
                        </View>
                      ) : null}
                      <View
                        style={[
                          styles.statusPill,
                          u.disabled ? styles.statusPillDisabled : styles.statusPillActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusPillText,
                            u.disabled
                              ? styles.statusPillTextDisabled
                              : styles.statusPillTextActive,
                          ]}
                        >
                          {u.disabled ? "Disabled" : "Active"}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.mutedSmall}>
                      {u.email} · Joined {formatDateTime(u.createdAt)}
                      {isSelf ? " · (You)" : ""}
                    </Text>
                  </View>

                  <View style={styles.inlineActions}>
                    <Button
                      label="Reset link"
                      variant="secondary"
                      disabled={createResetMutation.isPending}
                      onPress={() => void handleCreateResetLink(u.id, u.email)}
                      testID={`admin-reset-link-button-${u.id}`}
                    />
                    {!isSelf ? (
                      <Button
                        label={u.disabled ? "Re-enable" : "Disable"}
                        variant={u.disabled ? "primary" : "ghost"}
                        disabled={setDisabledMutation.isPending}
                        onPress={() => void handleToggleDisable(u.id, u.disabled)}
                        testID={`admin-toggle-disable-${u.id}`}
                      />
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  row: { gap: spacing.lg },
  rowDesktop: { flexDirection: "row", alignItems: "flex-start" },
  column: { flex: 1 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  muted: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  mutedSmall: { fontSize: 12, color: colors.textMuted },
  metrics: { gap: spacing.sm },
  list: { gap: spacing.sm },
  calloutBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    gap: spacing.xs,
  },
  calloutLabel: { fontSize: 13, fontWeight: "700", color: colors.accentPressed },
  calloutValue: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  inlineActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  userRow: {
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
  userInfo: { flex: 1, minWidth: 200, gap: 4 },
  badgeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  userName: { fontSize: 15, fontWeight: "700", color: colors.text },
  adminPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  adminPillText: { fontSize: 11, fontWeight: "700", color: colors.accentPressed },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  statusPillActive: { backgroundColor: colors.successSoft },
  statusPillDisabled: { backgroundColor: colors.errorSoft },
  statusPillText: { fontSize: 11, fontWeight: "700" },
  statusPillTextActive: { color: colors.success },
  statusPillTextDisabled: { color: colors.error },
});
