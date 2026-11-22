// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useCurrentUser } from "../../src/api/auth";
import { type BatchStatus, useBatches, useCreateBatch } from "../../src/api/batches";
import { useRecipes } from "../../src/api/recipes";
import { AppShell } from "../../src/components/AppShell";
import {
  formatBatchStatus,
  formatShortDate,
  formatVolume,
} from "../../src/components/batches/batchFlows";
import { Banner, Button, Card, SegmentedControl, TextField } from "../../src/components/ui";
import { useServer } from "../../src/state/server";
import { useUnits } from "../../src/state/units";
import { colors, radii, spacing } from "../../src/theme";

type ScopeFilter = "all" | "mine";
type StatusFilter = "all" | "planned" | "brewing" | "fermenting" | "primary" | "finished";

const SCOPE_OPTIONS: readonly { value: ScopeFilter; label: string }[] = [
  { value: "all", label: "All Visible" },
  { value: "mine", label: "My Batches" },
];

const STATUS_FILTER_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "planned", label: "Planned" },
  { value: "brewing", label: "Brewing" },
  { value: "fermenting", label: "Fermenting" },
  { value: "primary", label: "Primary" },
  { value: "finished", label: "Finished" },
];

export default function BatchesScreen() {
  const router = useRouter();
  const { serverUrl, authToken } = useServer();
  const { unitSystem } = useUnits();

  const [scope, setScope] = useState<ScopeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showStartForm, setShowStartForm] = useState(false);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [batchName, setBatchName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const currentUser = useCurrentUser(serverUrl, authToken);
  const batchesQuery = useBatches(serverUrl, authToken, {
    mine: scope === "mine",
    ...(statusFilter !== "all" ? { status: statusFilter as BatchStatus } : {}),
  });
  const recipesQuery = useRecipes(serverUrl, authToken, {
    enabled: Boolean(serverUrl && showStartForm),
  });
  const createBatch = useCreateBatch(serverUrl, authToken);

  if (!serverUrl) {
    return (
      <AppShell
        title="Batches"
        subtitle="Connect to a Brew-Bruvs server to track brew days, readings, and reminders."
      >
        <Card>
          <Banner
            tone="info"
            message="You are currently in offline mode. Calculators work offline; connect to a server to log and track batches."
          />
          <Button
            label="Connect to server"
            onPress={() => router.push("/connect")}
            testID="batches-connect-button"
          />
        </Card>
      </AppShell>
    );
  }

  const handleCreateBatch = async () => {
    setCreateError(null);
    if (!selectedRecipeId) {
      setCreateError("Select a recipe to start a batch.");
      return;
    }
    const trimmedName = batchName.trim();
    try {
      const created = await createBatch.mutateAsync({
        recipeId: selectedRecipeId,
        ...(trimmedName ? { name: trimmedName } : {}),
      });
      setShowStartForm(false);
      setBatchName("");
      setSelectedRecipeId(null);
      router.push(`/batches/${created.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not start batch.");
    }
  };

  return (
    <AppShell
      title="Batches"
      subtitle="Track brew days, mash and boil timers, fermentation curves, reminders, and tasting notes."
    >
      <Card>
        <View style={styles.toolbar}>
          <View style={styles.toolbarLeft}>
            {currentUser.data ? (
              <SegmentedControl
                options={SCOPE_OPTIONS}
                value={scope}
                onChange={setScope}
                accessibilityLabel="Batch ownership filter"
                compact
              />
            ) : null}
          </View>
          {currentUser.data ? (
            <Button
              label={showStartForm ? "Close" : "+ Start Batch"}
              variant={showStartForm ? "secondary" : "primary"}
              onPress={() => setShowStartForm((v) => !v)}
              testID="new-batch-button"
            />
          ) : (
            <Button
              label="Sign in to brew"
              variant="secondary"
              onPress={() => router.push("/login")}
            />
          )}
        </View>

        <SegmentedControl
          options={STATUS_FILTER_OPTIONS}
          value={statusFilter}
          onChange={setStatusFilter}
          accessibilityLabel="Filter batches by status"
        />

        {showStartForm ? (
          <View style={styles.startBox} testID="start-batch-panel">
            <Text style={styles.startTitle}>Start a Batch from a Recipe</Text>
            {recipesQuery.isPending ? (
              <Banner tone="info" message="Loading recipes..." />
            ) : recipesQuery.isError ? (
              <Banner tone="error" message="Could not load recipes." />
            ) : (recipesQuery.data?.length ?? 0) === 0 ? (
              <View style={styles.emptyRecipeBox}>
                <Text style={styles.muted}>Create a recipe first before starting a batch.</Text>
                <Button
                  label="Create recipe"
                  variant="secondary"
                  onPress={() => router.push("/recipes/new")}
                />
              </View>
            ) : (
              <>
                <View style={styles.recipePicker}>
                  {(recipesQuery.data ?? []).map((r) => {
                    const selected = selectedRecipeId === r.id;
                    return (
                      <Pressable
                        key={r.id}
                        onPress={() => {
                          setSelectedRecipeId(r.id);
                          if (!batchName.trim()) {
                            setBatchName(r.name);
                          }
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        testID={`pick-recipe-${r.id}`}
                        style={[styles.recipeOption, selected && styles.recipeOptionSelected]}
                      >
                        <Text
                          style={[
                            styles.recipeOptionName,
                            selected && styles.recipeOptionNameSelected,
                          ]}
                        >
                          {r.name}
                        </Text>
                        <Text style={styles.recipeOptionMeta}>
                          {r.beverage.toUpperCase()} · v{r.latestVersion}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <TextField
                  label="Batch Name (optional)"
                  value={batchName}
                  onChangeText={setBatchName}
                  placeholder="Defaults to recipe name"
                  testID="new-batch-name-input"
                />

                {createError ? <Banner tone="error" message={createError} /> : null}

                <Button
                  label={createBatch.isPending ? "Starting..." : "Start batch"}
                  disabled={createBatch.isPending || !selectedRecipeId}
                  onPress={() => void handleCreateBatch()}
                  testID="create-batch-submit-button"
                />
              </>
            )}
          </View>
        ) : null}
      </Card>

      {batchesQuery.isPending ? (
        <Card>
          <Banner tone="info" message="Loading batches..." />
        </Card>
      ) : batchesQuery.isError ? (
        <Card>
          <Banner
            tone="error"
            message={
              batchesQuery.error instanceof Error
                ? batchesQuery.error.message
                : "Could not load batches."
            }
          />
        </Card>
      ) : (batchesQuery.data?.length ?? 0) === 0 ? (
        <Card>
          <Text style={styles.emptyTitle}>No batches yet</Text>
          <Text style={styles.muted}>
            Start a batch from any recipe to unlock brew-day timers, fermentation tracking,
            reminders, and tasting notes.
          </Text>
        </Card>
      ) : (
        <View style={styles.list}>
          {(batchesQuery.data ?? []).map((batch) => (
            <Pressable
              key={batch.id}
              onPress={() => router.push(`/batches/${batch.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Open batch ${batch.name}`}
              testID={`batch-card-${batch.id}`}
              style={({ pressed }) => [styles.batchCard, pressed && styles.batchCardPressed]}
            >
              <View style={styles.batchHeader}>
                <Text style={styles.batchName}>{batch.name}</Text>
                <View style={styles.badges}>
                  <View style={styles.bevBadge}>
                    <Text style={styles.bevBadgeText}>{batch.beverage.toUpperCase()}</Text>
                  </View>
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusBadgeText}>{formatBatchStatus(batch.status)}</Text>
                  </View>
                </View>
              </View>
              <Text style={styles.batchMeta}>
                Recipe v{batch.recipe.version} · {formatVolume(batch.batchSizeL, unitSystem)} ·{" "}
                {batch.brewedAt
                  ? `Brewed ${formatShortDate(batch.brewedAt)}`
                  : `Created ${formatShortDate(batch.createdAt)}`}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  toolbarLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  startBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    gap: spacing.md,
  },
  startTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  emptyRecipeBox: { gap: spacing.sm },
  recipePicker: { gap: spacing.xs },
  recipeOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  recipeOptionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  recipeOptionName: { fontSize: 15, fontWeight: "600", color: colors.text },
  recipeOptionNameSelected: { color: colors.accentPressed, fontWeight: "700" },
  recipeOptionMeta: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  list: { gap: spacing.sm },
  batchCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  batchCardPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  batchHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  batchName: { fontSize: 18, fontWeight: "700", color: colors.text },
  badges: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  bevBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  bevBadgeText: { fontSize: 11, fontWeight: "700", color: colors.textMuted },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
  },
  statusBadgeText: { fontSize: 12, fontWeight: "700", color: colors.accentPressed },
  batchMeta: { fontSize: 13, color: colors.textMuted },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  muted: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
});
