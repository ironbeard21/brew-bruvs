// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  type Recipe,
  useAddRecipeShare,
  usePatchRecipe,
  useRecipeShares,
  useRemoveRecipeShare,
  type Visibility,
} from "../../api/recipes";
import { colors, radii, spacing } from "../../theme";
import { Banner, Button, Card, SegmentedControl, TextField } from "../ui";

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

const SHARE_LEVEL_OPTIONS = [
  { value: "read", label: "Read only", accessibilityLabel: "Read-only share" },
  { value: "edit", label: "Can edit", accessibilityLabel: "Editable share" },
] as const;

export interface RecipeSharingCardProps {
  serverUrl: string | null;
  authToken: string | null;
  recipe: Recipe;
  canManage: boolean;
  customFetch?: typeof fetch;
}

export function RecipeSharingCard({
  serverUrl,
  authToken,
  recipe,
  canManage,
  customFetch,
}: RecipeSharingCardProps) {
  const [pendingVisibility, setPendingVisibility] = useState<Visibility>(recipe.visibility);
  const [confirmPublic, setConfirmPublic] = useState(false);
  const [visStatus, setVisStatus] = useState<string | null>(null);
  const [visError, setVisError] = useState<string | null>(null);

  const [shareEmail, setShareEmail] = useState("");
  const [shareLevel, setShareLevel] = useState<"read" | "edit">("read");
  const [shareError, setShareError] = useState<string | null>(null);

  const shares = useRecipeShares(serverUrl, authToken, recipe.id, canManage, customFetch);
  const patchRecipe = usePatchRecipe(serverUrl, authToken, recipe.id, customFetch);
  const addShare = useAddRecipeShare(serverUrl, authToken, recipe.id, customFetch);
  const removeShare = useRemoveRecipeShare(serverUrl, authToken, recipe.id, customFetch);

  const needsPublicConfirmation =
    Boolean(recipe.credit) && (pendingVisibility === "unlisted" || pendingVisibility === "public");
  const blockedPublic = recipe.publicSharingBlocked && pendingVisibility === "public";

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
      await patchRecipe.mutateAsync({
        visibility: pendingVisibility,
        confirmPublic: needsPublicConfirmation ? confirmPublic : false,
      });
      setVisStatus(`Visibility updated to ${pendingVisibility}.`);
    } catch (err) {
      setVisError(err instanceof Error ? err.message : "Could not update visibility.");
    }
  };

  const handleAddShare = async () => {
    setShareError(null);
    if (!shareEmail.trim()) {
      setShareError("Enter a brewer's email address on this server.");
      return;
    }
    try {
      await addShare.mutateAsync({ email: shareEmail.trim(), level: shareLevel });
      setShareEmail("");
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Could not add share.");
    }
  };

  return (
    <Card>
      <Text style={styles.title}>Visibility & Sharing</Text>

      <SegmentedControl
        options={VISIBILITY_OPTIONS}
        value={pendingVisibility}
        onChange={(next) => {
          setPendingVisibility(next);
          setConfirmPublic(false);
          setVisError(null);
          setVisStatus(null);
        }}
        accessibilityLabel="Recipe visibility"
      />

      {recipe.publicSharingBlocked ? (
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
            I confirm the original source allows sharing this recipe (credit will remain attached).
          </Text>
        </Pressable>
      ) : null}

      {visError ? <Banner tone="error" message={visError} testID="visibility-error" /> : null}
      {visStatus ? <Banner tone="success" message={visStatus} testID="visibility-status" /> : null}

      {canManage ? (
        <Button
          label={patchRecipe.isPending ? "Saving visibility..." : "Update visibility"}
          variant="secondary"
          disabled={patchRecipe.isPending || blockedPublic}
          onPress={() => {
            void handleSaveVisibility();
          }}
          testID="save-visibility-button"
        />
      ) : null}

      {canManage ? (
        <View style={styles.sharesSection}>
          <Text style={styles.subTitle}>Shared With</Text>
          {shares.data && shares.data.length > 0 ? (
            <View style={styles.shareList}>
              {shares.data.map((share) => (
                <View key={share.id} style={styles.shareRow} testID={`share-row-${share.id}`}>
                  <View style={styles.shareMeta}>
                    <Text style={styles.shareName}>
                      {share.user?.displayName ?? share.breweryId ?? "Shared recipient"}
                    </Text>
                    <Text style={styles.shareLevel}>
                      {share.level === "edit" ? "Can edit" : "Read only"}
                    </Text>
                  </View>
                  <Button
                    label="Remove"
                    variant="ghost"
                    onPress={() => {
                      void removeShare.mutateAsync(share.id);
                    }}
                    accessibilityLabel={`Remove share for ${share.user?.displayName ?? "recipient"}`}
                  />
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>Not shared with individual users yet.</Text>
          )}

          <TextField
            label="Share with user by email"
            value={shareEmail}
            onChangeText={setShareEmail}
            placeholder="friend@example.com"
            keyboardType="email-address"
            testID="share-email-input"
          />

          <SegmentedControl
            options={SHARE_LEVEL_OPTIONS}
            value={shareLevel}
            onChange={setShareLevel}
            accessibilityLabel="Share permission level"
            compact
          />

          {shareError ? <Banner tone="error" message={shareError} testID="share-error" /> : null}

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
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  subTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
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
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  shareMeta: { flex: 1 },
  shareName: { fontSize: 14, fontWeight: "600", color: colors.text },
  shareLevel: { fontSize: 12, color: colors.textMuted },
  emptyText: { fontSize: 13, color: colors.textMuted },
});
