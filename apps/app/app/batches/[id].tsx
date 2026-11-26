// SPDX-License-Identifier: AGPL-3.0-or-later
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useCurrentUser } from "../../src/api/auth";
import {
  type BatchStatus,
  useAddReading,
  useAddReminder,
  useBatchDetail,
  useBatchNotes,
  useBatchReadings,
  useBatchReminders,
  useChangeBatchStatus,
  useCompleteReminder,
  useCreateNote,
  useDeleteBatch,
  useDeleteNote,
  useDeleteReading,
  useUpdateReading,
} from "../../src/api/batches";
import { useMoveBatchToBrewery } from "../../src/api/breweries";
import {
  fetchLowStock,
  type InventoryChange,
  useBatchReservations,
  useBatchStats,
  useShoppingList,
} from "../../src/api/inventory";
import { useRecipeVersion } from "../../src/api/recipes";
import { AppShell } from "../../src/components/AppShell";
import {
  BatchInventoryChangeBanner,
  BatchInventorySection,
} from "../../src/components/batches/BatchInventorySection";
import { BatchNotesSection } from "../../src/components/batches/BatchNotesSection";
import { BrewDayMode } from "../../src/components/batches/BrewDayMode";
import {
  formatBatchStatus,
  formatDateTime,
  formatVolume,
  getStatusFlow,
} from "../../src/components/batches/batchFlows";
import { PackagingStepCard } from "../../src/components/batches/PackagingStepCard";
import { ReadingsSection } from "../../src/components/batches/ReadingsSection";
import { RemindersSection } from "../../src/components/batches/RemindersSection";
import { MoveToBreweryBar } from "../../src/components/breweries/OwnerPickerCard";
import {
  buildBatchInventoryHref,
  canAccessOwnerInventory,
} from "../../src/components/inventory/inventoryScope";
import { OwnerBadge } from "../../src/components/OwnerBadge";
import { Banner, Button, Card, SegmentedControl } from "../../src/components/ui";
import { notifyLowStockItems } from "../../src/notifications";
import { useOptionalBrewery } from "../../src/state/brewery";
import { canPerformOnOwner } from "../../src/state/permissions";
import { useServer } from "../../src/state/server";
import { useUnits } from "../../src/state/units";
import { colors, radii, spacing } from "../../src/theme";

type BatchTab = "readings" | "brewday" | "inventory" | "reminders" | "packaging" | "notes";

const TAB_OPTIONS: readonly { value: BatchTab; label: string; accessibilityLabel: string }[] = [
  { value: "readings", label: "Readings", accessibilityLabel: "Batch readings and chart" },
  { value: "brewday", label: "Brew Day", accessibilityLabel: "Brew day checklist and timers" },
  {
    value: "inventory",
    label: "Inventory",
    accessibilityLabel: "Batch inventory reservations and lot stats",
  },
  { value: "reminders", label: "Reminders", accessibilityLabel: "Batch reminders" },
  { value: "packaging", label: "Packaging", accessibilityLabel: "Packaging and carbonation" },
  { value: "notes", label: "Notes", accessibilityLabel: "Batch notes and tasting scores" },
];

export default function BatchDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const batchId = typeof params.id === "string" ? params.id : "";

  const { serverUrl, authToken } = useServer();
  const { unitSystem } = useUnits();
  const { breweries, writableBreweries } = useOptionalBrewery();

  const [tab, setTab] = useState<BatchTab>("readings");
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [lastInventoryChange, setLastInventoryChange] = useState<InventoryChange | null>(null);
  const [lowStockAlert, setLowStockAlert] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const currentUser = useCurrentUser(serverUrl, authToken);
  const detailQuery = useBatchDetail(serverUrl, authToken, batchId || null);
  const readingsQuery = useBatchReadings(serverUrl, authToken, batchId || null);
  const remindersQuery = useBatchReminders(serverUrl, authToken, batchId || null);
  const notesQuery = useBatchNotes(serverUrl, authToken, batchId || null);
  const reservationsQuery = useBatchReservations(serverUrl, authToken, batchId || null);
  const statsQuery = useBatchStats(serverUrl, authToken, batchId || null);

  const batch = detailQuery.data;
  const ownerBreweryId = batch?.owner.type === "brewery" ? batch.owner.id : null;
  const canInspectBatchInventory = Boolean(
    batch && canAccessOwnerInventory(batch.owner, currentUser.data?.id, breweries),
  );
  const shoppingQuery = useShoppingList(serverUrl, authToken, {
    breweryId: ownerBreweryId,
    enabled: Boolean(
      serverUrl && currentUser.data && batch?.status === "planned" && canInspectBatchInventory,
    ),
  });
  const recipeVersionQuery = useRecipeVersion(
    serverUrl,
    authToken,
    batch?.recipe.id ?? null,
    batch?.recipe.version ?? null,
  );

  const changeStatus = useChangeBatchStatus(serverUrl, authToken, batchId);
  const deleteBatch = useDeleteBatch(serverUrl, authToken);
  const moveBatch = useMoveBatchToBrewery(serverUrl, authToken);
  const addReading = useAddReading(serverUrl, authToken, batchId);
  const updateReading = useUpdateReading(serverUrl, authToken, batchId);
  const deleteReading = useDeleteReading(serverUrl, authToken, batchId);
  const addReminder = useAddReminder(serverUrl, authToken, batchId);
  const completeReminder = useCompleteReminder(serverUrl, authToken, batchId);
  const createNote = useCreateNote(serverUrl, authToken, batchId);
  const deleteNote = useDeleteNote(serverUrl, authToken, batchId);

  if (!serverUrl) {
    return (
      <AppShell title="Batch" subtitle="Connect to a server to view batches.">
        <Card>
          <Banner tone="info" message="Connect to a Brew-Bruvs server to view this batch." />
          <Button label="Connect to server" onPress={() => router.push("/connect")} />
        </Card>
      </AppShell>
    );
  }

  if (detailQuery.isPending) {
    return (
      <AppShell title="Batch">
        <Card>
          <Banner tone="info" message="Loading batch..." />
        </Card>
      </AppShell>
    );
  }

  if (detailQuery.isError || !batch) {
    return (
      <AppShell title="Batch">
        <Card>
          <Banner
            tone="error"
            message={
              detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "Batch could not be loaded."
            }
          />
          <Button
            label="Back to batches"
            variant="secondary"
            onPress={() => router.push("/batches")}
          />
        </Card>
      </AppShell>
    );
  }

  const userId = currentUser.data?.id ?? null;
  const canContribute = canPerformOnOwner(userId, breweries, batch.owner, "contribute");
  const canEdit = canPerformOnOwner(userId, breweries, batch.owner, "edit");
  const canDelete = canPerformOnOwner(userId, breweries, batch.owner, "delete");
  const canMoveToBrewery =
    batch.owner.type === "user" && batch.owner.id === userId && writableBreweries.length > 0;
  const flow = getStatusFlow(batch.beverage);
  const currentIdx = flow.indexOf(batch.status);

  const handleMoveToBrewery = async (breweryId: string) => {
    setMoveNotice(null);
    await moveBatch.mutateAsync({ batchId: batch.id, breweryId });
    const target = writableBreweries.find((b) => b.id === breweryId);
    setMoveNotice(`Moved batch to ${target?.name ?? "brewery"}.`);
  };

  const handleChangeStatus = async (nextStatus: BatchStatus) => {
    setStatusError(null);
    setStatusNotice(null);
    setLowStockAlert(null);
    try {
      const res = await changeStatus.mutateAsync(nextStatus);
      setLastInventoryChange(res.inventory ?? null);
      if (res.addedReminders.length > 0) {
        setStatusNotice(
          `Moved to ${formatBatchStatus(nextStatus)}. Added ${res.addedReminders.length} scheduled reminder${res.addedReminders.length === 1 ? "" : "s"}!`,
        );
      } else if (res.scheduleError) {
        setStatusNotice(`Moved to ${formatBatchStatus(nextStatus)} (note: ${res.scheduleError}).`);
      } else {
        setStatusNotice(`Batch status updated to ${formatBatchStatus(nextStatus)}.`);
      }

      // When packaging/bottling consumes reservations, check low-stock thresholds and trigger local alerts.
      if (res.inventory?.used && serverUrl) {
        try {
          const lowItems = await fetchLowStock(serverUrl, authToken, ownerBreweryId);
          const workspaceName = ownerBreweryId
            ? breweries.find((b) => b.id === ownerBreweryId)?.name
            : undefined;
          const alertRes = await notifyLowStockItems(lowItems, unitSystem, {
            scopeKey: `${serverUrl}::${ownerBreweryId ?? "me"}`,
            ...(workspaceName ? { workspaceLabel: workspaceName } : {}),
          });
          if (alertRes.newlyAlerted.length > 0) {
            setLowStockAlert(
              `Low stock alert: ${alertRes.newlyAlerted.map((i) => i.name).join(", ")} dropped below threshold.`,
            );
          }
        } catch {
          // Non-fatal: status update already succeeded.
        }
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Could not change batch status.");
    }
  };

  const handleDeleteBatch = async () => {
    await deleteBatch.mutateAsync(batch.id);
    router.replace("/batches");
  };

  return (
    <AppShell
      title={batch.name}
      subtitle={`${batch.beverage.toUpperCase()} · ${formatBatchStatus(batch.status)} · ${formatVolume(batch.batchSizeL, unitSystem)} · Recipe v${batch.recipe.version}`}
    >
      {/* Status Flow & Header Actions */}
      <Card>
        <View style={styles.headerRow}>
          <View style={styles.headerMeta}>
            <View style={styles.titleRow}>
              <Text style={styles.sectionTitle}>
                {batch.beverage === "beer"
                  ? "Beer Workflow"
                  : `${batch.beverage.toUpperCase()} Workflow`}
              </Text>
              <OwnerBadge owner={batch.owner} currentUserId={userId} testID="batch-owner-badge" />
            </View>
            <Text style={styles.muted} testID="batch-current-status">
              Current stage: {formatBatchStatus(batch.status)}
              {batch.brewedAt ? ` · Started ${formatDateTime(batch.brewedAt)}` : ""}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Button
              label={`View recipe v${batch.recipe.version}`}
              variant="secondary"
              onPress={() => router.push(`/recipes/${batch.recipe.id}`)}
              testID="batch-open-recipe-button"
            />
            {canMoveToBrewery ? (
              <MoveToBreweryBar
                itemLabel="batch"
                writableBreweries={writableBreweries}
                moving={moveBatch.isPending}
                onMove={handleMoveToBrewery}
                testID="move-batch"
              />
            ) : null}
            {canDelete ? (
              confirmDelete ? (
                <>
                  <Button
                    label={deleteBatch.isPending ? "Deleting..." : "Confirm delete"}
                    variant="primary"
                    disabled={deleteBatch.isPending}
                    onPress={() => void handleDeleteBatch()}
                    testID="batch-confirm-delete-button"
                  />
                  <Button label="Cancel" variant="ghost" onPress={() => setConfirmDelete(false)} />
                </>
              ) : (
                <Button
                  label="Delete"
                  variant="ghost"
                  onPress={() => setConfirmDelete(true)}
                  testID="batch-delete-button"
                />
              )
            ) : null}
          </View>
        </View>
        {moveNotice ? (
          <Banner tone="success" message={moveNotice} testID="move-batch-notice" />
        ) : null}

        <View style={styles.flowTrack} testID="batch-status-flow">
          {flow.map((stage, idx) => {
            const isCurrent = stage === batch.status;
            const isAllowed = canEdit && batch.allowedStatuses.includes(stage);
            const isPast = currentIdx > idx;
            return (
              <Pressable
                key={stage}
                disabled={!isAllowed || changeStatus.isPending}
                onPress={() => void handleChangeStatus(stage)}
                accessibilityRole="button"
                accessibilityLabel={`Move batch to ${formatBatchStatus(stage)}`}
                accessibilityState={{ selected: isCurrent, disabled: !isAllowed }}
                testID={`status-step-${stage}`}
                style={[
                  styles.stagePill,
                  isPast && styles.stagePillPast,
                  isCurrent && styles.stagePillCurrent,
                  isAllowed && !isCurrent && styles.stagePillAllowed,
                  !isAllowed && !isCurrent && !isPast && styles.stagePillLocked,
                ]}
              >
                <Text
                  style={[
                    styles.stageText,
                    isPast && styles.stageTextPast,
                    isCurrent && styles.stageTextCurrent,
                    isAllowed && !isCurrent && styles.stageTextAllowed,
                  ]}
                >
                  {isPast ? "✓ " : ""}
                  {formatBatchStatus(stage)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {statusNotice ? (
          <Banner tone="success" message={statusNotice} testID="batch-status-notice" />
        ) : null}
        {statusError ? (
          <Banner tone="error" message={statusError} testID="batch-status-error" />
        ) : null}
        {lastInventoryChange ? (
          <BatchInventoryChangeBanner
            change={lastInventoryChange}
            lowStockMessage={lowStockAlert}
            {...(canInspectBatchInventory
              ? {
                  onOpenShoppingList: () =>
                    router.push(buildBatchInventoryHref(batch.owner, "shopping")),
                }
              : {})}
            onDismiss={() => {
              setLastInventoryChange(null);
              setLowStockAlert(null);
            }}
          />
        ) : lowStockAlert ? (
          <Banner tone="error" message={lowStockAlert} testID="batch-low-stock-alert" />
        ) : null}

        {batch.statusHistory.length > 0 ? (
          <View style={styles.historyRow}>
            <Text style={styles.historyLabel}>History:</Text>
            {batch.statusHistory.map((h, i) => (
              <Text key={`${h.status}-${h.changedAt}`} style={styles.historyItem}>
                {formatBatchStatus(h.status)} ({formatDateTime(h.changedAt)})
                {i < batch.statusHistory.length - 1 ? " →" : ""}
              </Text>
            ))}
          </View>
        ) : null}
      </Card>

      {/* Section Navigation */}
      <SegmentedControl
        options={TAB_OPTIONS}
        value={tab}
        onChange={setTab}
        accessibilityLabel="Batch sections"
      />

      {tab === "readings" ? (
        <ReadingsSection
          beverage={batch.beverage}
          readings={readingsQuery.data ?? []}
          loading={readingsQuery.isPending}
          canEdit={canEdit}
          canContribute={canContribute}
          saving={addReading.isPending || updateReading.isPending || deleteReading.isPending}
          onAddReading={async (input) => {
            await addReading.mutateAsync(input);
          }}
          onUpdateReading={async (readingId, patch) => {
            await updateReading.mutateAsync({ readingId, patch });
          }}
          onDeleteReading={async (readingId) => {
            await deleteReading.mutateAsync(readingId);
          }}
        />
      ) : null}

      {tab === "brewday" ? (
        <BrewDayMode
          batchId={batch.id}
          batchName={batch.name}
          beverage={batch.beverage}
          recipeVersion={recipeVersionQuery.data}
          loadingRecipe={recipeVersionQuery.isPending}
        />
      ) : null}

      {tab === "inventory" ? (
        <BatchInventorySection
          batch={batch}
          reservations={reservationsQuery.data ?? []}
          loadingReservations={reservationsQuery.isPending}
          stats={statsQuery.data ?? null}
          loadingStats={statsQuery.isPending}
          shoppingList={shoppingQuery.data ?? null}
          {...(canInspectBatchInventory
            ? {
                onOpenInventory: () => router.push(buildBatchInventoryHref(batch.owner, "stock")),
                onOpenShoppingList: () =>
                  router.push(buildBatchInventoryHref(batch.owner, "shopping")),
              }
            : {})}
        />
      ) : null}

      {tab === "reminders" ? (
        <RemindersSection
          reminders={remindersQuery.data ?? []}
          loading={remindersQuery.isPending}
          canEdit={canEdit}
          {...(serverUrl && userId ? { scopeKey: `${serverUrl}::${userId}` } : {})}
          saving={addReminder.isPending || completeReminder.isPending}
          onAddReminder={async (input) => {
            await addReminder.mutateAsync(input);
          }}
          onCompleteReminder={async (reminderId) => {
            await completeReminder.mutateAsync(reminderId);
          }}
        />
      ) : null}

      {tab === "packaging" ? (
        <PackagingStepCard
          batch={batch}
          canEdit={canEdit}
          saving={changeStatus.isPending}
          onChangeStatus={handleChangeStatus}
          onOpenCalculators={() => router.push("/calculators")}
        />
      ) : null}

      {tab === "notes" ? (
        <BatchNotesSection
          batchId={batch.id}
          notes={notesQuery.data ?? []}
          loading={notesQuery.isPending}
          canEdit={canEdit}
          canContribute={canContribute}
          canDeleteNote={(note) => canPerformOnOwner(userId, breweries, note.owner, "delete")}
          saving={createNote.isPending || deleteNote.isPending}
          onCreateNote={async (input) => {
            await createNote.mutateAsync(input);
          }}
          onDeleteNote={async (noteId) => {
            await deleteNote.mutateAsync(noteId);
          }}
        />
      ) : null}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  headerMeta: { flex: 1, minWidth: 200, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  muted: { fontSize: 13, color: colors.textMuted },
  flowTrack: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  stagePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  stagePillPast: {
    backgroundColor: colors.successSoft,
    borderColor: colors.success,
  },
  stagePillCurrent: {
    backgroundColor: colors.accent,
    borderColor: colors.accentPressed,
  },
  stagePillAllowed: {
    backgroundColor: colors.surface,
    borderColor: colors.accent,
  },
  stagePillLocked: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    opacity: 0.65,
  },
  stageText: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  stageTextPast: { color: colors.success },
  stageTextCurrent: { color: colors.accentText, fontWeight: "700" },
  stageTextAllowed: { color: colors.accentPressed },
  historyRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  historyLabel: { fontSize: 12, fontWeight: "700", color: colors.textMuted },
  historyItem: { fontSize: 12, color: colors.textMuted },
});
