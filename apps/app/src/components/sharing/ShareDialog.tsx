// SPDX-License-Identifier: AGPL-3.0-or-later
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Brewery, ResourceOwner } from "../../api/breweries";
import {
  RESOURCE_LABELS,
  type ShareableResourceType,
  useAddResourceShare,
  useRemoveResourceShare,
  useResourceShares,
  useSetResourceVisibility,
  type Visibility,
  visibilityCacheKey,
} from "../../api/sharing";
import { useOptionalBrewery } from "../../state/brewery";
import { colors, radii, spacing } from "../../theme";
import { Banner, Button, Card, SegmentedControl, TextField } from "../ui";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VISIBILITY_OPTIONS: readonly {
  value: Visibility;
  label: string;
  accessibilityLabel: string;
}[] = [
  { value: "private", label: "Private", accessibilityLabel: "Private visibility" },
  { value: "unlisted", label: "Unlisted", accessibilityLabel: "Unlisted link visibility" },
  { value: "server", label: "Server", accessibilityLabel: "Server members visibility" },
  { value: "public", label: "Public", accessibilityLabel: "Public visibility" },
];

const SHARE_TARGET_OPTIONS = [
  { value: "user", label: "Person", accessibilityLabel: "Share with a person by email" },
  { value: "brewery", label: "Brewery", accessibilityLabel: "Share with a brewery" },
] as const;

const SHARE_LEVEL_OPTIONS = [
  { value: "read", label: "Read only", accessibilityLabel: "Read-only share" },
  { value: "edit", label: "Can edit", accessibilityLabel: "Editable share" },
] as const;

const TYPE_TITLES: Record<ShareableResourceType, string> = {
  recipe: "Recipe",
  batch: "Batch",
  note: "Note",
  inventory_item: "Inventory Item",
  equipment_item: "Equipment Item",
  equipment_profile: "Equipment Profile",
};

export interface SharePanelProps {
  serverUrl: string | null;
  authToken: string | null;
  resourceType: ShareableResourceType;
  resourceId: string;
  visibility?: Visibility | null;
  owner?: ResourceOwner | null;
  canManage: boolean;
  hasCredit?: boolean;
  publicSharingBlocked?: boolean;
  breweries?: readonly Pick<Brewery, "id" | "name">[];
  showTitle?: boolean;
  customFetch?: typeof fetch;
}

export function SharePanel({
  serverUrl,
  authToken,
  resourceType,
  resourceId,
  visibility = null,
  owner = null,
  canManage,
  hasCredit = false,
  publicSharingBlocked = false,
  breweries: breweriesProp,
  showTitle = false,
  customFetch,
}: SharePanelProps) {
  const queryClient = useQueryClient();
  const breweryCtx = useOptionalBrewery();
  const allBreweries = breweriesProp ?? breweryCtx.breweries;

  const cachedVisibility = queryClient.getQueryData<Visibility>(
    visibilityCacheKey(serverUrl, resourceType, resourceId),
  );
  const resolvedVisibility: Visibility = visibility ?? cachedVisibility ?? "private";
  const visibilityKnown = visibility != null || cachedVisibility != null;

  const [pendingVisibility, setPendingVisibility] = useState<Visibility>(resolvedVisibility);
  const [confirmPublic, setConfirmPublic] = useState(false);
  const [visStatus, setVisStatus] = useState<string | null>(null);
  const [visError, setVisError] = useState<string | null>(null);

  const [targetMode, setTargetMode] = useState<"user" | "brewery">("user");
  const [shareEmail, setShareEmail] = useState("");
  const [shareBreweryId, setShareBreweryId] = useState("");
  const [shareLevel, setShareLevel] = useState<"read" | "edit">("read");
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    setPendingVisibility(resolvedVisibility);
    setConfirmPublic(false);
  }, [resolvedVisibility]);

  const shares = useResourceShares(
    serverUrl,
    authToken,
    resourceType,
    resourceId,
    canManage,
    customFetch,
  );
  const setVisibility = useSetResourceVisibility(
    serverUrl,
    authToken,
    resourceType,
    resourceId,
    customFetch,
  );
  const addShare = useAddResourceShare(serverUrl, authToken, resourceType, resourceId, customFetch);
  const removeShare = useRemoveResourceShare(
    serverUrl,
    authToken,
    resourceType,
    resourceId,
    customFetch,
  );

  const shareableBreweries = allBreweries.filter(
    (b) => !(owner?.type === "brewery" && owner.id === b.id),
  );

  const needsPublicConfirmation =
    resourceType === "recipe" &&
    hasCredit &&
    (pendingVisibility === "unlisted" || pendingVisibility === "public");
  const blockedPublic =
    resourceType === "recipe" && publicSharingBlocked && pendingVisibility === "public";

  const handleSaveVisibility = async () => {
    setVisError(null);
    setVisStatus(null);
    if (blockedPublic) {
      setVisError("This imported recipe's source terms forbid public sharing.");
      return;
    }
    if (needsPublicConfirmation && !confirmPublic) {
      setVisError("Confirm that the original recipe's source allows sharing before saving.");
      return;
    }
    try {
      const updated = await setVisibility.mutateAsync({
        visibility: pendingVisibility,
        confirmPublic: needsPublicConfirmation ? confirmPublic : false,
      });
      setVisStatus(`Visibility updated to ${updated.visibility}.`);
    } catch (err) {
      setVisError(err instanceof Error ? err.message : "Could not update visibility.");
    }
  };

  const handleAddShare = async () => {
    setShareError(null);
    setShareNotice(null);
    if (targetMode === "user") {
      const trimmed = shareEmail.trim();
      if (!trimmed) {
        setShareError("Enter a brewer's email address on this server.");
        return;
      }
      try {
        await addShare.mutateAsync({ email: trimmed, level: shareLevel });
        setShareEmail("");
        setShareNotice(
          `Shared with ${trimmed} (${shareLevel === "edit" ? "Can edit" : "Read only"}).`,
        );
      } catch (err) {
        setShareError(err instanceof Error ? err.message : "Could not add share.");
      }
      return;
    }

    const trimmedBrewery = shareBreweryId.trim();
    if (!trimmedBrewery) {
      setShareError("Select a brewery or enter a brewery ID.");
      return;
    }
    if (!UUID_RE.test(trimmedBrewery)) {
      setShareError("Enter a valid brewery UUID.");
      return;
    }
    try {
      await addShare.mutateAsync({ breweryId: trimmedBrewery, level: shareLevel });
      const matched = allBreweries.find((b) => b.id === trimmedBrewery);
      setShareBreweryId("");
      setShareNotice(
        `Shared with ${matched ? matched.name : "brewery"} (${shareLevel === "edit" ? "Can edit" : "Read only"}).`,
      );
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Could not share with brewery.");
    }
  };

  const handleChangeBreweryShareLevel = async (breweryId: string, nextLevel: "read" | "edit") => {
    setShareError(null);
    setShareNotice(null);
    try {
      await addShare.mutateAsync({ breweryId, level: nextLevel });
      const matched = allBreweries.find((b) => b.id === breweryId);
      setShareNotice(
        `Updated ${matched ? matched.name : "brewery"} to ${nextLevel === "edit" ? "Can edit" : "Read only"}.`,
      );
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Could not update share level.");
    }
  };

  const handleRemoveShare = async (shareId: string) => {
    setShareError(null);
    setShareNotice(null);
    try {
      await removeShare.mutateAsync(shareId);
      setShareNotice("Removed share.");
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Could not remove share.");
    }
  };

  const resolveRecipientLabel = (share: {
    user: { id: string; displayName: string } | null;
    breweryId: string | null;
  }) => {
    if (share.user) {
      return { name: share.user.displayName, kind: "Person" as const };
    }
    if (share.breweryId) {
      const matched = allBreweries.find((b) => b.id === share.breweryId);
      return {
        name: matched ? matched.name : `Brewery (${share.breweryId.slice(0, 8)}…)`,
        kind: "Brewery" as const,
      };
    }
    return { name: "Shared recipient", kind: "Person" as const };
  };

  return (
    <View style={styles.panelRoot} testID={`share-panel-${resourceType}`}>
      {showTitle ? <Text style={styles.title}>Visibility & Sharing</Text> : null}

      <View style={styles.section}>
        <Text style={styles.subTitle}>Visibility</Text>
        <SegmentedControl
          options={VISIBILITY_OPTIONS}
          value={pendingVisibility}
          onChange={(next) => {
            setPendingVisibility(next);
            setConfirmPublic(false);
            setVisError(null);
            setVisStatus(null);
          }}
          accessibilityLabel={`${TYPE_TITLES[resourceType]} visibility`}
        />
        {!visibilityKnown ? (
          <Text style={styles.hintText}>
            Starts private by default; choose a level and save to update who can see this{" "}
            {RESOURCE_LABELS[resourceType]}.
          </Text>
        ) : null}

        {resourceType === "recipe" && publicSharingBlocked ? (
          <Banner
            tone="info"
            message="Public sharing is blocked for this imported recipe by its source terms."
            testID="public-sharing-blocked-banner"
          />
        ) : null}

        {needsPublicConfirmation && !blockedPublic ? (
          <Pressable
            onPress={() => setConfirmPublic((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityLabel="Confirm source allows sharing this imported recipe"
            accessibilityState={{ checked: confirmPublic }}
            testID="confirm-public-checkbox"
            style={styles.checkboxRow}
          >
            <View style={[styles.checkbox, confirmPublic && styles.checkboxChecked]}>
              {confirmPublic ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.checkboxLabel}>
              I confirm the original source allows sharing this recipe (credit will remain
              attached).
            </Text>
          </Pressable>
        ) : null}

        {visError ? <Banner tone="error" message={visError} testID="visibility-error" /> : null}
        {visStatus ? (
          <Banner tone="success" message={visStatus} testID="visibility-status" />
        ) : null}

        {canManage ? (
          <Button
            label={setVisibility.isPending ? "Saving visibility..." : "Update visibility"}
            variant="secondary"
            disabled={setVisibility.isPending || blockedPublic}
            onPress={() => {
              void handleSaveVisibility();
            }}
            testID="save-visibility-button"
          />
        ) : null}
      </View>

      {canManage ? (
        <View style={styles.sharesSection}>
          <Text style={styles.subTitle}>People & Breweries</Text>

          {shares.isPending ? (
            <Text style={styles.emptyText}>Loading shares...</Text>
          ) : shares.isError ? (
            <Banner
              tone="error"
              message={
                shares.error instanceof Error ? shares.error.message : "Could not load shares."
              }
            />
          ) : shares.data && shares.data.length > 0 ? (
            <View style={styles.shareList} testID="share-list">
              {shares.data.map((share) => {
                const recipient = resolveRecipientLabel(share);
                const nextLevel = share.level === "edit" ? "read" : "edit";
                return (
                  <View key={share.id} style={styles.shareRow} testID={`share-row-${share.id}`}>
                    <View style={styles.shareMeta}>
                      <View style={styles.shareNameRow}>
                        <Text style={styles.shareName}>{recipient.name}</Text>
                        <View style={styles.kindBadge}>
                          <Text style={styles.kindBadgeText}>{recipient.kind}</Text>
                        </View>
                      </View>
                      <Text style={styles.shareLevel}>
                        {share.level === "edit" ? "Can edit" : "Read only"}
                      </Text>
                    </View>
                    <View style={styles.shareRowActions}>
                      {share.breweryId ? (
                        <Button
                          label={nextLevel === "edit" ? "Allow edit" : "Read only"}
                          variant="ghost"
                          disabled={addShare.isPending}
                          onPress={() => {
                            if (share.breweryId) {
                              void handleChangeBreweryShareLevel(share.breweryId, nextLevel);
                            }
                          }}
                          accessibilityLabel={`Change ${recipient.name} share to ${nextLevel === "edit" ? "can edit" : "read only"}`}
                          testID={`toggle-share-level-${share.id}`}
                        />
                      ) : null}
                      <Button
                        label="Remove"
                        variant="ghost"
                        disabled={removeShare.isPending}
                        onPress={() => {
                          void handleRemoveShare(share.id);
                        }}
                        accessibilityLabel={`Remove share for ${recipient.name}`}
                        testID={`remove-share-${share.id}`}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyText}>
              Not shared with individual people or breweries yet.
            </Text>
          )}

          <SegmentedControl
            options={SHARE_TARGET_OPTIONS}
            value={targetMode}
            onChange={(next) => {
              setTargetMode(next);
              setShareError(null);
            }}
            accessibilityLabel="Share recipient type"
            compact
          />

          {targetMode === "user" ? (
            <TextField
              label="Share with user by email"
              value={shareEmail}
              onChangeText={setShareEmail}
              placeholder="friend@example.com"
              keyboardType="email-address"
              helper="Sharing again with the same email updates their permission level."
              testID="share-email-input"
            />
          ) : (
            <View style={styles.breweryPickerSection}>
              {shareableBreweries.length > 0 ? (
                <View style={styles.breweryChips} testID="share-brewery-chips">
                  {shareableBreweries.map((b) => {
                    const selected = shareBreweryId === b.id;
                    return (
                      <Pressable
                        key={b.id}
                        onPress={() => setShareBreweryId(b.id)}
                        accessibilityRole="radio"
                        accessibilityLabel={`Select brewery ${b.name}`}
                        accessibilityState={{ selected }}
                        testID={`share-brewery-option-${b.id}`}
                        style={[styles.breweryChip, selected && styles.breweryChipSelected]}
                      >
                        <Text
                          style={[
                            styles.breweryChipText,
                            selected && styles.breweryChipTextSelected,
                          ]}
                        >
                          {b.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.hintText}>
                  Enter a brewery ID on this server to share with that brewery.
                </Text>
              )}

              <TextField
                label="Brewery ID"
                value={shareBreweryId}
                onChangeText={setShareBreweryId}
                placeholder="Select a brewery above or paste a brewery UUID"
                testID="share-brewery-id-input"
              />
            </View>
          )}

          <SegmentedControl
            options={SHARE_LEVEL_OPTIONS}
            value={shareLevel}
            onChange={setShareLevel}
            accessibilityLabel="Share permission level"
            compact
          />

          {shareError ? <Banner tone="error" message={shareError} testID="share-error" /> : null}
          {shareNotice ? (
            <Banner tone="success" message={shareNotice} testID="share-notice" />
          ) : null}

          <Button
            label={addShare.isPending ? "Sharing..." : "Add share"}
            variant="secondary"
            disabled={addShare.isPending}
            onPress={() => {
              void handleAddShare();
            }}
            testID="add-share-button"
          />
        </View>
      ) : null}
    </View>
  );
}

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  serverUrl: string | null;
  authToken: string | null;
  resourceType: ShareableResourceType;
  resourceId: string;
  resourceName: string;
  visibility?: Visibility | null;
  owner?: ResourceOwner | null;
  canManage: boolean;
  hasCredit?: boolean;
  publicSharingBlocked?: boolean;
  breweries?: readonly Pick<Brewery, "id" | "name">[];
  customFetch?: typeof fetch;
}

export function ShareDialog({
  open,
  onClose,
  serverUrl,
  authToken,
  resourceType,
  resourceId,
  resourceName,
  visibility = null,
  owner = null,
  canManage,
  hasCredit = false,
  publicSharingBlocked = false,
  breweries,
  customFetch,
}: ShareDialogProps) {
  if (!open) return null;

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.modalOverlay} testID="share-dialog">
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close share dialog"
          style={styles.modalBackdrop}
        />
        <View style={styles.modalSheet}>
          <ScrollView
            contentContainerStyle={styles.modalScroll}
            keyboardShouldPersistTaps="handled"
          >
            <Card style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View style={styles.modalTitleCol}>
                  <Text style={styles.modalTypeLabel}>{TYPE_TITLES[resourceType]}</Text>
                  <Text style={styles.title} testID="share-dialog-title">
                    Share {resourceName}
                  </Text>
                </View>
                <Button
                  label="Done"
                  variant="ghost"
                  onPress={onClose}
                  accessibilityLabel="Close share dialog"
                  testID="share-dialog-close"
                />
              </View>

              <SharePanel
                key={`${resourceType}:${resourceId}`}
                serverUrl={serverUrl}
                authToken={authToken}
                resourceType={resourceType}
                resourceId={resourceId}
                visibility={visibility}
                owner={owner}
                canManage={canManage}
                hasCredit={hasCredit}
                publicSharingBlocked={publicSharingBlocked}
                {...(breweries ? { breweries } : {})}
                {...(customFetch ? { customFetch } : {})}
              />
            </Card>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panelRoot: { gap: spacing.md },
  section: { gap: spacing.sm },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  subTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  hintText: { fontSize: 12, lineHeight: 17, color: colors.textMuted },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.accentPressed,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
  },
  checkmark: {
    color: colors.accentText,
    fontSize: 14,
    fontWeight: "700",
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: colors.accentPressed,
  },
  sharesSection: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  shareList: { gap: spacing.xs },
  shareRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  shareMeta: { flex: 1, minWidth: 150, gap: 2 },
  shareNameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  shareName: { fontSize: 14, fontWeight: "600", color: colors.text },
  kindBadge: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  kindBadgeText: { fontSize: 11, fontWeight: "700", color: colors.textMuted },
  shareLevel: { fontSize: 12, color: colors.textMuted },
  shareRowActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  emptyText: { fontSize: 13, color: colors.textMuted },
  breweryPickerSection: { gap: spacing.sm },
  breweryChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  breweryChip: {
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    justifyContent: "center",
  },
  breweryChipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  breweryChipText: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  breweryChipTextSelected: { color: colors.accentPressed, fontWeight: "700" },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.md,
    zIndex: 9999,
  },
  modalBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(28, 25, 23, 0.58)",
  },
  modalSheet: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "90%",
    zIndex: 1,
  },
  modalScroll: {
    flexGrow: 1,
    justifyContent: "center",
  },
  modalCard: {
    backgroundColor: colors.surface,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitleCol: { flex: 1, gap: 2 },
  modalTypeLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.accentPressed,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});
