// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  type Brewery,
  type BreweryDetail,
  useAcceptBreweryInvite,
  useCreateBrewery,
  useDeclineBreweryInvite,
  useMyBreweryInvites,
} from "../../api/breweries";
import { useOptionalBrewery } from "../../state/brewery";
import { canManageBrewery } from "../../state/permissions";
import { useThemedStyles } from "../../state/theme";
import { DESKTOP_BREAKPOINT, radii, spacing, type ThemeColors } from "../../theme";
import { RoleBadge } from "../OwnerBadge";
import { Banner, Button, Card, TextField } from "../ui";
import { InventoryPreviewCard } from "./InventoryPreviewCard";

function formatLocation(city: string | null, state: string | null): string | null {
  const parts = [city?.trim(), state?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export interface BreweryHubProps {
  serverUrl: string;
  authToken: string | null;
  currentUserId: string;
  breweries?: readonly Brewery[];
  activeBreweryId?: string | null;
  onSelectWorkspace?: (breweryId: string | null) => void;
  onOpenBrewery?: (breweryId: string) => void;
  onCreatedBrewery?: (brewery: BreweryDetail) => void;
  onAcceptedInvite?: (brewery: BreweryDetail) => void;
  customFetch?: typeof fetch;
}

export function BreweryHub({
  serverUrl,
  authToken,
  currentUserId,
  breweries: breweriesProp,
  activeBreweryId: activeBreweryIdProp,
  onSelectWorkspace,
  onOpenBrewery,
  onCreatedBrewery,
  onAcceptedInvite,
  customFetch,
}: BreweryHubProps) {
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const ctx = useOptionalBrewery();

  const breweries = breweriesProp ?? ctx.breweries;
  const activeBreweryId =
    activeBreweryIdProp !== undefined ? activeBreweryIdProp : ctx.activeBreweryId;
  const selectWorkspace = onSelectWorkspace ?? ctx.setActiveBreweryId;

  const activeBrewery = activeBreweryId
    ? (breweries.find((b) => b.id === activeBreweryId) ?? null)
    : null;

  const myInvitesQuery = useMyBreweryInvites(serverUrl, authToken, true, customFetch);
  const createBrewery = useCreateBrewery(serverUrl, authToken, customFetch);
  const acceptInvite = useAcceptBreweryInvite(serverUrl, authToken, customFetch);
  const declineInvite = useDeclineBreweryInvite(serverUrl, authToken, customFetch);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState("");
  const [stateRegion, setStateRegion] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreateError(null);
    setCreateSuccess(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setCreateError("Enter a brewery name.");
      return;
    }
    try {
      const created = await createBrewery.mutateAsync({
        name: trimmedName,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(city.trim() ? { city: city.trim() } : {}),
        ...(stateRegion.trim() ? { state: stateRegion.trim() } : {}),
      });
      setName("");
      setDescription("");
      setCity("");
      setStateRegion("");
      setCreateSuccess(`Created "${created.name}".`);
      selectWorkspace(created.id);
      onCreatedBrewery?.(created);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create brewery.");
    }
  };

  const handleAcceptById = async (inviteId: string) => {
    setInviteError(null);
    setInviteSuccess(null);
    try {
      const joined = await acceptInvite.mutateAsync({ id: inviteId });
      setInviteSuccess(`Joined "${joined.name}".`);
      selectWorkspace(joined.id);
      onAcceptedInvite?.(joined);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not accept invite.");
    }
  };

  const handleAcceptByCode = async () => {
    setInviteError(null);
    setInviteSuccess(null);
    const code = inviteCode.trim();
    if (!code) {
      setInviteError("Paste an invite code first.");
      return;
    }
    try {
      const joined = await acceptInvite.mutateAsync({ code });
      setInviteCode("");
      setInviteSuccess(`Joined "${joined.name}".`);
      selectWorkspace(joined.id);
      onAcceptedInvite?.(joined);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not accept invite code.");
    }
  };

  const handleDecline = async (inviteId: string) => {
    setInviteError(null);
    setInviteSuccess(null);
    try {
      await declineInvite.mutateAsync(inviteId);
      setInviteSuccess("Invite declined.");
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not decline invite.");
    }
  };

  const myInvites = myInvitesQuery.data ?? [];

  return (
    <View style={styles.root} testID="brewery-hub">
      {/* Active Workspace Summary */}
      <Card>
        <View style={styles.rowBetween}>
          <View style={styles.flexCol}>
            <Text style={styles.sectionTitle}>Active Workspace</Text>
            <Text style={styles.muted} testID="active-workspace-summary">
              {activeBrewery
                ? `Working as ${activeBrewery.name}. Recipes, batches, and inventory filter to this brewery.`
                : "Working as Me (personal). Recipes, batches, and inventory default to your personal account."}
            </Text>
          </View>
          {activeBrewery ? (
            <Button
              label="Switch to Me"
              variant="secondary"
              onPress={() => selectWorkspace(null)}
              testID="hub-switch-me-button"
            />
          ) : null}
        </View>
      </Card>

      <View style={[styles.columns, isDesktop && styles.columnsDesktop]}>
        {/* Left Column: Your Breweries & Incoming Invites */}
        <View style={[styles.stack, isDesktop && styles.column]}>
          <Card>
            <Text style={styles.sectionTitle}>Your Breweries ({breweries.length})</Text>
            {breweries.length === 0 ? (
              <Text style={styles.muted} testID="breweries-empty">
                You do not belong to any breweries yet. Create one or join with an invite.
              </Text>
            ) : (
              <View style={styles.list} testID="breweries-list">
                {breweries.map((b) => {
                  const isActive = activeBreweryId === b.id;
                  const loc = formatLocation(b.city, b.state);
                  const isOwner = canManageBrewery(b.role);
                  return (
                    <View
                      key={b.id}
                      style={[styles.breweryCard, isActive && styles.breweryCardActive]}
                      testID={`brewery-row-${b.id}`}
                    >
                      <View style={styles.rowBetween}>
                        <View style={styles.flexCol}>
                          <Text style={styles.breweryName}>{b.name}</Text>
                          {loc ? <Text style={styles.metaText}>{loc}</Text> : null}
                        </View>
                        <RoleBadge role={b.role} testID={`brewery-role-badge-${b.id}`} />
                      </View>
                      {b.description ? (
                        <Text style={styles.description}>{b.description}</Text>
                      ) : null}
                      <View style={styles.actionsRow}>
                        <Button
                          label={isActive ? "Active workspace" : "Switch to brewery"}
                          variant={isActive ? "secondary" : "primary"}
                          disabled={isActive}
                          onPress={() => selectWorkspace(b.id)}
                          accessibilityLabel={`Switch workspace to ${b.name}`}
                          testID={`brewery-select-${b.id}`}
                        />
                        {onOpenBrewery ? (
                          <Button
                            label={isOwner ? "Manage" : "Open"}
                            variant="secondary"
                            onPress={() => onOpenBrewery(b.id)}
                            accessibilityLabel={`${isOwner ? "Manage" : "Open"} ${b.name}`}
                            testID={`brewery-open-${b.id}`}
                          />
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </Card>

          <Card>
            <Text style={styles.sectionTitle}>Pending Invites</Text>
            {myInvitesQuery.isPending ? (
              <Banner tone="info" message="Checking invites..." />
            ) : myInvitesQuery.isError ? (
              <Banner
                tone="error"
                message={
                  myInvitesQuery.error instanceof Error
                    ? myInvitesQuery.error.message
                    : "Could not load invites."
                }
              />
            ) : myInvites.length === 0 ? (
              <Text style={styles.muted} testID="my-invites-empty">
                No email invites waiting for you.
              </Text>
            ) : (
              <View style={styles.list} testID="my-invites-list">
                {myInvites.map((inv) => (
                  <View key={inv.id} style={styles.inviteRow} testID={`my-invite-${inv.id}`}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.breweryName}>{inv.brewery.name}</Text>
                      <RoleBadge role={inv.role} />
                    </View>
                    <Text style={styles.metaText}>
                      Expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </Text>
                    <View style={styles.actionsRow}>
                      <Button
                        label={acceptInvite.isPending ? "Joining..." : "Accept invite"}
                        disabled={acceptInvite.isPending || declineInvite.isPending}
                        onPress={() => void handleAcceptById(inv.id)}
                        accessibilityLabel={`Accept invite to ${inv.brewery.name}`}
                        testID={`accept-invite-${inv.id}`}
                      />
                      <Button
                        label="Decline"
                        variant="ghost"
                        disabled={acceptInvite.isPending || declineInvite.isPending}
                        onPress={() => void handleDecline(inv.id)}
                        accessibilityLabel={`Decline invite to ${inv.brewery.name}`}
                        testID={`decline-invite-${inv.id}`}
                      />
                    </View>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.divider} />

            <Text style={styles.subTitle}>Join with a One-Time Code</Text>
            <TextField
              label="Invite Code"
              value={inviteCode}
              onChangeText={setInviteCode}
              placeholder="Paste the code shared by a brewery owner"
              testID="join-invite-code-input"
              onSubmitEditing={() => void handleAcceptByCode()}
            />
            {inviteError ? (
              <Banner tone="error" message={inviteError} testID="join-invite-error" />
            ) : null}
            {inviteSuccess ? (
              <Banner tone="success" message={inviteSuccess} testID="join-invite-success" />
            ) : null}
            <Button
              label={acceptInvite.isPending ? "Joining..." : "Join brewery"}
              variant="secondary"
              disabled={acceptInvite.isPending}
              onPress={() => void handleAcceptByCode()}
              testID="join-invite-code-submit"
            />
          </Card>
        </View>

        {/* Right Column: Create a Brewery + Current Workspace Inventory Preview */}
        <View style={[styles.stack, isDesktop && styles.column]}>
          <Card>
            <Text style={styles.sectionTitle}>Create a Brewery</Text>
            <Text style={styles.muted}>
              Share recipes, batches, inventory, and equipment with friends. You start as an Owner.
            </Text>
            <TextField
              label="Brewery Name"
              value={name}
              onChangeText={setName}
              placeholder="Northside Brew Club"
              autoCapitalize="words"
              testID="create-brewery-name-input"
            />
            <TextField
              label="Description (optional)"
              value={description}
              onChangeText={setDescription}
              placeholder="Weekend garage brewers sharing grain and kegs"
              autoCapitalize="sentences"
              testID="create-brewery-description-input"
            />
            <View style={styles.fieldRow}>
              <View style={styles.halfField}>
                <TextField
                  label="City (optional)"
                  value={city}
                  onChangeText={setCity}
                  placeholder="Portland"
                  autoCapitalize="words"
                  testID="create-brewery-city-input"
                />
              </View>
              <View style={styles.halfField}>
                <TextField
                  label="State / Region (optional)"
                  value={stateRegion}
                  onChangeText={setStateRegion}
                  placeholder="OR"
                  autoCapitalize="characters"
                  testID="create-brewery-state-input"
                />
              </View>
            </View>
            <Text style={styles.metaText}>
              Location is city and state only — never enter a street address.
            </Text>
            {createError ? (
              <Banner tone="error" message={createError} testID="create-brewery-error" />
            ) : null}
            {createSuccess ? (
              <Banner tone="success" message={createSuccess} testID="create-brewery-success" />
            ) : null}
            <Button
              label={createBrewery.isPending ? "Creating..." : "Create brewery"}
              disabled={createBrewery.isPending}
              onPress={() => void handleCreate()}
              testID="create-brewery-submit"
            />
          </Card>

          <InventoryPreviewCard
            serverUrl={serverUrl}
            authToken={authToken}
            breweryId={activeBrewery?.id ?? null}
            title={activeBrewery ? `${activeBrewery.name} Inventory` : "My Inventory"}
            currentUserId={currentUserId}
            breweries={breweries}
            {...(customFetch ? { customFetch } : {})}
          />
        </View>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { gap: spacing.lg },
    columns: { gap: spacing.lg },
    columnsDesktop: { flexDirection: "row", alignItems: "flex-start" },
    column: { flex: 1 },
    stack: { gap: spacing.lg },
    sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
    subTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
    muted: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
    metaText: { fontSize: 12, color: colors.textMuted },
    description: { fontSize: 14, lineHeight: 20, color: colors.text },
    rowBetween: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    flexCol: { flex: 1, minWidth: 180, gap: 2 },
    list: { gap: spacing.sm },
    breweryCard: {
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.sm,
    },
    breweryCardActive: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    breweryName: { fontSize: 16, fontWeight: "700", color: colors.text },
    actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    inviteRow: {
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.xs,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: spacing.xs,
    },
    fieldRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
    halfField: { flex: 1, minWidth: 130 },
  });
