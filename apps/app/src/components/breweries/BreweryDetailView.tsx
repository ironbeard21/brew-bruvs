// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  type BreweryDetail,
  type BreweryPatch,
  type BreweryRole,
  useBreweryInvites,
  useDeleteBrewery,
  useInviteToBrewery,
  useRemoveBreweryMember,
  useRevokeBreweryInvite,
  useSetBreweryRole,
  useTransferBrewery,
  useUpdateBrewery,
} from "../../api/breweries";
import { useOptionalBrewery } from "../../state/brewery";
import {
  BREWERY_ROLES,
  canManageBrewery,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
} from "../../state/permissions";
import { colors, DESKTOP_BREAKPOINT, radii, spacing } from "../../theme";
import { RoleBadge } from "../OwnerBadge";
import { Banner, Button, Card, SegmentedControl, TextField } from "../ui";
import { BreweryActivityFeed } from "./BreweryActivityFeed";
import { InventoryPreviewCard } from "./InventoryPreviewCard";

const ROLE_OPTIONS = BREWERY_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
  accessibilityLabel: `${ROLE_LABELS[role]} role`,
}));

const INVITE_MODE_OPTIONS = [
  { value: "code", label: "One-time code", accessibilityLabel: "Create a one-time invite code" },
  { value: "email", label: "By email", accessibilityLabel: "Invite a server member by email" },
] as const;

async function copyText(value: string, label: string): Promise<string> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return `${label} copied to clipboard.`;
    } catch {
      return `Copy the ${label.toLowerCase()} above.`;
    }
  }
  return `Copy the ${label.toLowerCase()} above.`;
}

export interface BreweryDetailViewProps {
  serverUrl: string;
  authToken: string | null;
  currentUserId: string;
  detail: BreweryDetail;
  activeBreweryId?: string | null;
  onSelectWorkspace?: (breweryId: string | null) => void;
  onLeftOrDeleted?: () => void;
  onOpenBatch?: (batchId: string) => void;
  onOpenEquipment?: (breweryId: string) => void;
  customFetch?: typeof fetch;
}

export function BreweryDetailView({
  serverUrl,
  authToken,
  currentUserId,
  detail,
  activeBreweryId: activeBreweryIdProp,
  onSelectWorkspace,
  onLeftOrDeleted,
  onOpenBatch,
  onOpenEquipment,
  customFetch,
}: BreweryDetailViewProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const ctx = useOptionalBrewery();

  const activeBreweryId =
    activeBreweryIdProp !== undefined ? activeBreweryIdProp : ctx.activeBreweryId;
  const selectWorkspace = onSelectWorkspace ?? ctx.setActiveBreweryId;

  const isOwner = canManageBrewery(detail.role);
  const ownerCount = detail.members.filter((m) => m.role === "owner").length;
  const isSoleOwner = detail.role === "owner" && ownerCount <= 1;
  const isActive = activeBreweryId === detail.id;

  const invitesQuery = useBreweryInvites(serverUrl, authToken, detail.id, isOwner, customFetch);
  const updateBrewery = useUpdateBrewery(serverUrl, authToken, detail.id, customFetch);
  const deleteBrewery = useDeleteBrewery(serverUrl, authToken, customFetch);
  const setRole = useSetBreweryRole(serverUrl, authToken, detail.id, customFetch);
  const removeMember = useRemoveBreweryMember(serverUrl, authToken, detail.id, customFetch);
  const transferBrewery = useTransferBrewery(serverUrl, authToken, detail.id, customFetch);
  const createInvite = useInviteToBrewery(serverUrl, authToken, detail.id, customFetch);
  const revokeInvite = useRevokeBreweryInvite(serverUrl, authToken, detail.id, customFetch);

  // Settings form state (owners)
  const [editName, setEditName] = useState(detail.name);
  const [editDescription, setEditDescription] = useState(detail.description ?? "");
  const [editCity, setEditCity] = useState(detail.city ?? "");
  const [editState, setEditState] = useState(detail.state ?? "");
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Member actions state
  const [memberNotice, setMemberNotice] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmTransferId, setConfirmTransferId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Invite form state (owners)
  const [inviteMode, setInviteMode] = useState<"code" | "email">("code");
  const [inviteRole, setInviteRole] = useState<BreweryRole>("member");
  const [inviteEmail, setInviteEmail] = useState("");
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    setEditName(detail.name);
    setEditDescription(detail.description ?? "");
    setEditCity(detail.city ?? "");
    setEditState(detail.state ?? "");
  }, [detail.name, detail.description, detail.city, detail.state]);

  const handleSaveSettings = async () => {
    setSettingsError(null);
    setSettingsNotice(null);
    const trimmedName = editName.trim();
    if (!trimmedName) {
      setSettingsError("Brewery name cannot be empty.");
      return;
    }
    const patch: BreweryPatch = {};
    if (trimmedName !== detail.name) patch.name = trimmedName;
    const nextDesc = editDescription.trim() || null;
    if (nextDesc !== (detail.description ?? null)) patch.description = nextDesc;
    const nextCity = editCity.trim() || null;
    if (nextCity !== (detail.city ?? null)) patch.city = nextCity;
    const nextState = editState.trim() || null;
    if (nextState !== (detail.state ?? null)) patch.state = nextState;

    if (Object.keys(patch).length === 0) {
      setSettingsNotice("No changes to save.");
      return;
    }
    try {
      await updateBrewery.mutateAsync(patch);
      setSettingsNotice("Brewery details saved.");
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Could not update brewery.");
    }
  };

  const handleDeleteBrewery = async () => {
    setSettingsError(null);
    try {
      await deleteBrewery.mutateAsync(detail.id);
      if (isActive) selectWorkspace(null);
      onLeftOrDeleted?.();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Could not delete brewery.");
      setConfirmDelete(false);
    }
  };

  const handleRoleChange = async (userId: string, nextRole: BreweryRole) => {
    setMemberError(null);
    setMemberNotice(null);
    try {
      await setRole.mutateAsync({ userId, role: nextRole });
      setMemberNotice(`Updated role to ${ROLE_LABELS[nextRole]}.`);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Could not change role.");
    }
  };

  const handleRemoveMember = async (userId: string, displayName: string) => {
    setMemberError(null);
    setMemberNotice(null);
    try {
      await removeMember.mutateAsync(userId);
      setConfirmRemoveId(null);
      setMemberNotice(`Removed ${displayName} from the brewery.`);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Could not remove member.");
    }
  };

  const handleTransferOwnership = async (userId: string, displayName: string) => {
    setMemberError(null);
    setMemberNotice(null);
    try {
      await transferBrewery.mutateAsync(userId);
      setConfirmTransferId(null);
      setMemberNotice(`Transferred ownership to ${displayName}. Your role is now Brewer.`);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Could not transfer ownership.");
    }
  };

  const handleLeave = async () => {
    setMemberError(null);
    try {
      await removeMember.mutateAsync(currentUserId);
      if (isActive) selectWorkspace(null);
      onLeftOrDeleted?.();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Could not leave brewery.");
      setConfirmLeave(false);
    }
  };

  const handleCreateInvite = async () => {
    setInviteError(null);
    setInviteNotice(null);
    setGeneratedCode(null);
    if (inviteMode === "email" && !inviteEmail.trim()) {
      setInviteError("Enter an email address to invite.");
      return;
    }
    try {
      const created = await createInvite.mutateAsync(
        inviteMode === "email"
          ? { role: inviteRole, email: inviteEmail.trim() }
          : { role: inviteRole },
      );
      if (created.code) {
        setGeneratedCode(created.code);
        setInviteNotice("One-time invite code created. Copy it now — it is shown once.");
      } else {
        setInviteEmail("");
        setInviteNotice(`Invite sent to ${created.email ?? "the user"}.`);
      }
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not create invite.");
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    setInviteError(null);
    setInviteNotice(null);
    try {
      await revokeInvite.mutateAsync(inviteId);
      setInviteNotice("Invite revoked.");
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not revoke invite.");
    }
  };

  const location = [detail.city, detail.state].filter(Boolean).join(", ");
  const pendingInvites = invitesQuery.data ?? [];

  return (
    <View style={styles.root} testID="brewery-detail-view">
      {/* Header Summary Card */}
      <Card>
        <View style={styles.rowBetween}>
          <View style={styles.flexCol}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{detail.name}</Text>
              <RoleBadge role={detail.role} testID="my-brewery-role-badge" />
            </View>
            {location ? <Text style={styles.metaText}>{location}</Text> : null}
            {detail.description ? (
              <Text style={styles.description}>{detail.description}</Text>
            ) : null}
            <Text style={styles.muted} testID="my-role-description">
              {ROLE_DESCRIPTIONS[detail.role]}
            </Text>
          </View>
          <View style={styles.actionsRow}>
            {onOpenEquipment ? (
              <Button
                label="Equipment"
                variant="secondary"
                onPress={() => onOpenEquipment(detail.id)}
                testID="detail-open-equipment-button"
              />
            ) : null}
            {isActive ? (
              <Button
                label="Switch back to Me"
                variant="secondary"
                onPress={() => selectWorkspace(null)}
                testID="detail-switch-me-button"
              />
            ) : (
              <Button
                label="Switch to this brewery"
                onPress={() => selectWorkspace(detail.id)}
                testID="detail-switch-brewery-button"
              />
            )}
          </View>
        </View>
      </Card>

      <View style={[styles.columns, isDesktop && styles.columnsDesktop]}>
        {/* Left Column: Members + Leave */}
        <View style={[styles.stack, isDesktop && styles.column]}>
          <Card>
            <Text style={styles.sectionTitle}>Members ({detail.members.length})</Text>
            {memberNotice ? (
              <Banner tone="success" message={memberNotice} testID="member-action-notice" />
            ) : null}
            {memberError ? (
              <Banner tone="error" message={memberError} testID="member-action-error" />
            ) : null}

            <View style={styles.list} testID="brewery-members-list">
              {detail.members.map((member) => {
                const isSelf = member.userId === currentUserId;
                const lockedSoleOwner = member.role === "owner" && ownerCount <= 1;
                return (
                  <View
                    key={member.userId}
                    style={styles.memberCard}
                    testID={`member-row-${member.userId}`}
                  >
                    <View style={styles.rowBetween}>
                      <View style={styles.flexCol}>
                        <Text style={styles.memberName}>
                          {member.displayName}
                          {isSelf ? " (you)" : ""}
                        </Text>
                        <Text style={styles.metaText}>
                          Joined {new Date(member.joinedAt).toLocaleDateString()}
                        </Text>
                      </View>
                      <RoleBadge role={member.role} testID={`member-role-${member.userId}`} />
                    </View>

                    {isOwner ? (
                      <View style={styles.ownerControls} testID={`owner-controls-${member.userId}`}>
                        {lockedSoleOwner ? (
                          <Text style={styles.metaText}>
                            Sole owner — promote another member or transfer ownership before
                            changing this role.
                          </Text>
                        ) : (
                          <SegmentedControl
                            options={ROLE_OPTIONS}
                            value={member.role}
                            onChange={(nextRole) => {
                              if (nextRole !== member.role) {
                                void handleRoleChange(member.userId, nextRole);
                              }
                            }}
                            accessibilityLabel={`Change role for ${member.displayName}`}
                            compact
                          />
                        )}

                        {!isSelf ? (
                          <View style={styles.actionsRow}>
                            {confirmTransferId === member.userId ? (
                              <>
                                <Button
                                  label={
                                    transferBrewery.isPending
                                      ? "Transferring..."
                                      : "Confirm transfer"
                                  }
                                  disabled={transferBrewery.isPending}
                                  onPress={() =>
                                    void handleTransferOwnership(member.userId, member.displayName)
                                  }
                                  testID={`confirm-transfer-${member.userId}`}
                                />
                                <Button
                                  label="Cancel"
                                  variant="ghost"
                                  onPress={() => setConfirmTransferId(null)}
                                />
                              </>
                            ) : (
                              <Button
                                label="Transfer ownership"
                                variant="secondary"
                                onPress={() => {
                                  setConfirmTransferId(member.userId);
                                  setConfirmRemoveId(null);
                                }}
                                accessibilityLabel={`Transfer ownership to ${member.displayName}`}
                                testID={`transfer-ownership-${member.userId}`}
                              />
                            )}

                            {confirmRemoveId === member.userId ? (
                              <>
                                <Button
                                  label={removeMember.isPending ? "Removing..." : "Confirm remove"}
                                  variant="secondary"
                                  disabled={removeMember.isPending}
                                  onPress={() =>
                                    void handleRemoveMember(member.userId, member.displayName)
                                  }
                                  testID={`confirm-remove-${member.userId}`}
                                />
                                <Button
                                  label="Cancel"
                                  variant="ghost"
                                  onPress={() => setConfirmRemoveId(null)}
                                />
                              </>
                            ) : (
                              <Button
                                label="Remove"
                                variant="ghost"
                                onPress={() => {
                                  setConfirmRemoveId(member.userId);
                                  setConfirmTransferId(null);
                                }}
                                accessibilityLabel={`Remove ${member.displayName}`}
                                testID={`remove-member-${member.userId}`}
                              />
                            )}
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>

            <View style={styles.divider} />

            {isSoleOwner ? (
              <Text style={styles.muted} testID="leave-blocked-sole-owner">
                You are the only owner. Transfer ownership or make another member an owner before
                leaving this brewery.
              </Text>
            ) : confirmLeave ? (
              <View style={styles.actionsRow}>
                <Button
                  label={removeMember.isPending ? "Leaving..." : "Confirm leave brewery"}
                  disabled={removeMember.isPending}
                  onPress={() => void handleLeave()}
                  testID="confirm-leave-brewery-button"
                />
                <Button label="Cancel" variant="ghost" onPress={() => setConfirmLeave(false)} />
              </View>
            ) : (
              <Button
                label="Leave brewery"
                variant="secondary"
                onPress={() => setConfirmLeave(true)}
                testID="leave-brewery-button"
              />
            )}
          </Card>

          {/* Brewery Inventory Preview */}
          <InventoryPreviewCard
            serverUrl={serverUrl}
            authToken={authToken}
            breweryId={detail.id}
            title={`${detail.name} Inventory`}
            currentUserId={currentUserId}
            breweries={[detail]}
            {...(customFetch ? { customFetch } : {})}
          />
        </View>

        {/* Right Column: Activity Feed (all members) + Owner-Only Invites & Settings */}
        <View style={[styles.stack, isDesktop && styles.column]}>
          <BreweryActivityFeed
            serverUrl={serverUrl}
            authToken={authToken}
            breweryId={detail.id}
            breweryName={detail.name}
            {...(onOpenBatch ? { onOpenBatch } : {})}
            {...(onOpenEquipment ? { onOpenEquipment: () => onOpenEquipment(detail.id) } : {})}
            {...(customFetch ? { customFetch } : {})}
          />

          {isOwner ? (
            <>
              <Card>
                <Text style={styles.sectionTitle} testID="brewery-invites-section">
                  Invite Members
                </Text>
                <SegmentedControl
                  options={INVITE_MODE_OPTIONS}
                  value={inviteMode}
                  onChange={(next) => {
                    setInviteMode(next);
                    setInviteError(null);
                    setInviteNotice(null);
                  }}
                  accessibilityLabel="Invite method"
                  compact
                />
                <Text style={styles.fieldLabel}>Role for invitee</Text>
                <SegmentedControl
                  options={ROLE_OPTIONS}
                  value={inviteRole}
                  onChange={setInviteRole}
                  accessibilityLabel="Role for invited member"
                  compact
                />
                <Text style={styles.metaText}>{ROLE_DESCRIPTIONS[inviteRole]}</Text>

                {inviteMode === "email" ? (
                  <TextField
                    label="Email address on this server"
                    value={inviteEmail}
                    onChangeText={setInviteEmail}
                    placeholder="friend@example.com"
                    keyboardType="email-address"
                    testID="brewery-invite-email-input"
                  />
                ) : null}

                {inviteError ? (
                  <Banner tone="error" message={inviteError} testID="brewery-invite-error" />
                ) : null}
                {inviteNotice ? (
                  <Banner tone="success" message={inviteNotice} testID="brewery-invite-notice" />
                ) : null}

                {generatedCode ? (
                  <View style={styles.secretBox} testID="brewery-invite-code-box">
                    <Text style={styles.secretLabel}>One-time invite code (shown once)</Text>
                    <Text selectable style={styles.secretValue} testID="brewery-invite-code-value">
                      {generatedCode}
                    </Text>
                    <Button
                      label="Copy code"
                      variant="secondary"
                      onPress={() => {
                        void copyText(generatedCode, "Invite code").then(setInviteNotice);
                      }}
                      testID="copy-brewery-invite-code"
                    />
                  </View>
                ) : null}

                <Button
                  label={
                    createInvite.isPending
                      ? "Creating invite..."
                      : inviteMode === "code"
                        ? "Create one-time invite code"
                        : "Send email invite"
                  }
                  disabled={createInvite.isPending}
                  onPress={() => void handleCreateInvite()}
                  testID="create-brewery-invite-button"
                />

                <View style={styles.divider} />
                <Text style={styles.subTitle}>Pending Invites ({pendingInvites.length})</Text>
                {invitesQuery.isPending ? (
                  <Banner tone="info" message="Loading invites..." />
                ) : pendingInvites.length === 0 ? (
                  <Text style={styles.muted}>No pending invites.</Text>
                ) : (
                  <View style={styles.list} testID="brewery-pending-invites">
                    {pendingInvites.map((inv) => (
                      <View
                        key={inv.id}
                        style={styles.pendingInviteRow}
                        testID={`pending-invite-${inv.id}`}
                      >
                        <View style={styles.flexCol}>
                          <Text style={styles.memberName}>
                            {inv.email ?? "One-time invite code"}
                          </Text>
                          <Text style={styles.metaText}>
                            {ROLE_LABELS[inv.role]} · Expires{" "}
                            {new Date(inv.expiresAt).toLocaleDateString()}
                          </Text>
                        </View>
                        <Button
                          label="Revoke"
                          variant="ghost"
                          disabled={revokeInvite.isPending}
                          onPress={() => void handleRevokeInvite(inv.id)}
                          accessibilityLabel={`Revoke invite ${inv.email ?? "code"}`}
                          testID={`revoke-invite-${inv.id}`}
                        />
                      </View>
                    ))}
                  </View>
                )}
              </Card>

              <Card>
                <Text style={styles.sectionTitle} testID="brewery-settings-section">
                  Brewery Settings
                </Text>
                <TextField
                  label="Brewery Name"
                  value={editName}
                  onChangeText={setEditName}
                  autoCapitalize="words"
                  testID="edit-brewery-name-input"
                />
                <TextField
                  label="Description"
                  value={editDescription}
                  onChangeText={setEditDescription}
                  placeholder="About this brewery"
                  autoCapitalize="sentences"
                  testID="edit-brewery-description-input"
                />
                <View style={styles.fieldRow}>
                  <View style={styles.halfField}>
                    <TextField
                      label="City"
                      value={editCity}
                      onChangeText={setEditCity}
                      placeholder="Portland"
                      autoCapitalize="words"
                      testID="edit-brewery-city-input"
                    />
                  </View>
                  <View style={styles.halfField}>
                    <TextField
                      label="State / Region"
                      value={editState}
                      onChangeText={setEditState}
                      placeholder="OR"
                      autoCapitalize="characters"
                      testID="edit-brewery-state-input"
                    />
                  </View>
                </View>

                {settingsError ? (
                  <Banner tone="error" message={settingsError} testID="brewery-settings-error" />
                ) : null}
                {settingsNotice ? (
                  <Banner
                    tone="success"
                    message={settingsNotice}
                    testID="brewery-settings-notice"
                  />
                ) : null}

                <Button
                  label={updateBrewery.isPending ? "Saving..." : "Save changes"}
                  disabled={updateBrewery.isPending}
                  onPress={() => void handleSaveSettings()}
                  testID="save-brewery-settings-button"
                />

                <View style={styles.divider} />
                <Text style={styles.subTitle}>Delete Brewery</Text>
                <Text style={styles.metaText}>
                  Only an empty brewery can be deleted. Delete or move its recipes, batches, and
                  items first.
                </Text>
                {confirmDelete ? (
                  <View style={styles.actionsRow}>
                    <Button
                      label={deleteBrewery.isPending ? "Deleting..." : "Confirm delete brewery"}
                      disabled={deleteBrewery.isPending}
                      onPress={() => void handleDeleteBrewery()}
                      testID="confirm-delete-brewery-button"
                    />
                    <Button
                      label="Cancel"
                      variant="ghost"
                      onPress={() => setConfirmDelete(false)}
                    />
                  </View>
                ) : (
                  <Button
                    label="Delete brewery"
                    variant="ghost"
                    onPress={() => setConfirmDelete(true)}
                    testID="delete-brewery-button"
                  />
                )}
              </Card>
            </>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  columns: { gap: spacing.lg },
  columnsDesktop: { flexDirection: "row", alignItems: "flex-start" },
  column: { flex: 1 },
  stack: { gap: spacing.lg },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  flexCol: { flex: 1, minWidth: 180, gap: 4 },
  title: { fontSize: 20, fontWeight: "800", color: colors.text },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  subTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  fieldLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
  description: { fontSize: 14, lineHeight: 20, color: colors.text },
  muted: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  metaText: { fontSize: 12, color: colors.textMuted },
  list: { gap: spacing.sm },
  memberCard: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  memberName: { fontSize: 15, fontWeight: "700", color: colors.text },
  ownerControls: { gap: spacing.sm, paddingTop: spacing.xs },
  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  secretBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    gap: spacing.xs,
  },
  secretLabel: { fontSize: 12, fontWeight: "700", color: colors.accentPressed },
  secretValue: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  pendingInviteRow: {
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
  fieldRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  halfField: { flex: 1, minWidth: 130 },
});
