// SPDX-License-Identifier: AGPL-3.0-or-later
import { StyleSheet, Text, View } from "react-native";
import type { BatchDetail } from "../../api/batches";
import type { BatchStats, InventoryChange, Reservation, ShoppingList } from "../../api/inventory";
import { useUnits } from "../../state/units";
import { colors, radii, spacing } from "../../theme";
import { formatInventoryAmount } from "../inventory/inventoryUnits";
import { Banner, Button, Card } from "../ui";

export interface BatchInventoryChangeBannerProps {
  change: InventoryChange;
  lowStockMessage?: string | null;
  onOpenShoppingList?: () => void;
  onDismiss?: () => void;
}

/** Shown immediately after starting, packaging/bottling, or undoing a batch status move. */
export function BatchInventoryChangeBanner({
  change,
  lowStockMessage = null,
  onOpenShoppingList,
  onDismiss,
}: BatchInventoryChangeBannerProps) {
  const { unitSystem } = useUnits();
  const hasContent =
    change.reserved.length > 0 || change.short.length > 0 || change.used || change.released;

  if (!hasContent && !lowStockMessage) return null;

  return (
    <View style={styles.changeBox} testID="batch-inventory-change">
      <View style={styles.rowBetween}>
        <Text style={styles.changeTitle}>Inventory Update</Text>
        {onDismiss ? <Button label="Dismiss" variant="ghost" onPress={onDismiss} /> : null}
      </View>

      {change.used ? (
        <Banner
          tone="success"
          message="Reserved ingredients were used up from inventory."
          testID="batch-inventory-used-banner"
        />
      ) : null}

      {change.released ? (
        <Banner
          tone="info"
          message="Reserved ingredients were released back to available inventory."
          testID="batch-inventory-released-banner"
        />
      ) : null}

      {change.reserved.length > 0 ? (
        <View style={styles.group} testID="batch-inventory-reserved-summary">
          <Text style={styles.groupLabel}>Reserved from inventory ({change.reserved.length}):</Text>
          {change.reserved.map((r) => (
            <View
              key={`${r.itemId}-${r.unit}`}
              style={styles.lineRow}
              testID={`batch-reserved-line-${r.itemId}`}
            >
              <Text style={styles.lineName}>{r.name}</Text>
              <Text style={styles.reservedQty}>
                {formatInventoryAmount(r.quantity, r.unit, unitSystem)} reserved
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {change.short.length > 0 ? (
        <View style={styles.shortBox} testID="batch-inventory-short-summary">
          <Text style={styles.shortTitle}>
            Short of {change.short.length}{" "}
            {change.short.length === 1 ? "ingredient" : "ingredients"} (batch started anyway):
          </Text>
          {change.short.map((s, idx) => (
            <View
              key={`${s.catalogId ?? s.name}-${s.unit}`}
              style={styles.lineRow}
              testID={`batch-short-line-${idx}`}
            >
              <Text style={styles.lineName}>{s.name}</Text>
              <Text style={styles.shortQty}>
                Short {formatInventoryAmount(s.short, s.unit, unitSystem)}
              </Text>
            </View>
          ))}
          {onOpenShoppingList ? (
            <View style={styles.actionRow}>
              <Button
                label="Open shopping list"
                variant="secondary"
                onPress={onOpenShoppingList}
                testID="batch-open-shopping-list-button"
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {lowStockMessage ? (
        <Banner tone="error" message={lowStockMessage} testID="batch-low-stock-alert" />
      ) : null}
    </View>
  );
}

export interface BatchInventorySectionProps {
  batch: BatchDetail;
  reservations: readonly Reservation[];
  loadingReservations?: boolean;
  stats?: BatchStats | null;
  loadingStats?: boolean;
  shoppingList?: ShoppingList | null;
  onOpenInventory?: () => void;
  onOpenShoppingList?: () => void;
}

export function BatchInventorySection({
  batch,
  reservations,
  loadingReservations = false,
  stats = null,
  loadingStats = false,
  shoppingList = null,
  onOpenInventory,
  onOpenShoppingList,
}: BatchInventorySectionProps) {
  const { unitSystem } = useUnits();

  const plannedShortfalls =
    batch.status === "planned" && shoppingList
      ? shoppingList.short.filter((s) => s.batches.some((b) => b.id === batch.id))
      : [];

  return (
    <View style={styles.root} testID="batch-inventory-section">
      {/* Reservations */}
      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>
            Batch Inventory Reservations ({reservations.length})
          </Text>
          <View style={styles.actionRow}>
            {onOpenInventory ? (
              <Button
                label="Open inventory"
                variant="secondary"
                onPress={onOpenInventory}
                testID="batch-section-open-inventory"
              />
            ) : null}
            {onOpenShoppingList ? (
              <Button
                label="Shopping list"
                variant="ghost"
                onPress={onOpenShoppingList}
                testID="batch-section-open-shopping"
              />
            ) : null}
          </View>
        </View>

        {loadingReservations ? <Banner tone="info" message="Loading reservations..." /> : null}

        {!loadingReservations && reservations.length === 0 ? (
          <Text style={styles.muted} testID="batch-reservations-empty">
            {batch.status === "planned"
              ? "Ingredients will be reserved from the batch owner's inventory when you move this batch to Brewing or Primary."
              : "No inventory items are reserved for this batch."}
          </Text>
        ) : (
          <View style={styles.list} testID="batch-reservations-list">
            {reservations.map((r, idx) => (
              <View
                key={`${r.itemId}-${r.unit}-${r.state}`}
                style={styles.resRow}
                testID={`batch-reservation-item-${idx}`}
              >
                <View style={styles.flexCol}>
                  <Text style={styles.lineName}>{r.name}</Text>
                  <Text style={styles.muted}>
                    {formatInventoryAmount(r.quantity, r.unit, unitSystem)}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statePill,
                    r.state === "used"
                      ? styles.stateUsed
                      : r.state === "reserved"
                        ? styles.stateReserved
                        : styles.stateReleased,
                  ]}
                >
                  <Text
                    style={[
                      styles.statePillText,
                      r.state === "used"
                        ? styles.stateUsedText
                        : r.state === "reserved"
                          ? styles.stateReservedText
                          : styles.stateReleasedText,
                    ]}
                  >
                    {r.state}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {plannedShortfalls.length > 0 ? (
          <View style={styles.shortBox} testID="batch-planned-shortfalls">
            <Text style={styles.shortTitle}>
              Currently short for this planned batch ({plannedShortfalls.length}):
            </Text>
            {plannedShortfalls.map((s, idx) => (
              <View
                key={`${s.catalogId ?? s.name}-${s.unit}`}
                style={styles.lineRow}
                testID={`batch-planned-short-${idx}`}
              >
                <Text style={styles.lineName}>{s.name}</Text>
                <Text style={styles.shortQty}>
                  Short {formatInventoryAmount(s.short, s.unit, unitSystem)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      {/* Lot-adjusted Batch Stats */}
      <Card>
        <Text style={styles.sectionTitle}>Batch Stats & Lot Alpha Acid</Text>
        {loadingStats ? <Banner tone="info" message="Calculating batch stats..." /> : null}
        {!loadingStats && stats?.stats ? (
          <View style={styles.statsWrap} testID="batch-stats-values">
            <View style={styles.statChip}>
              <Text style={styles.statLabel}>OG</Text>
              <Text style={styles.statVal}>{stats.stats.og.toFixed(3)}</Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statLabel}>FG</Text>
              <Text style={styles.statVal}>{stats.stats.fg.toFixed(3)}</Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statLabel}>ABV</Text>
              <Text style={styles.statVal}>{stats.stats.abvPct.toFixed(1)}%</Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statLabel}>IBU</Text>
              <Text style={styles.statVal}>{stats.stats.ibu.toFixed(0)}</Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statLabel}>Color</Text>
              <Text style={styles.statVal}>
                {unitSystem === "us"
                  ? `${stats.stats.colorSrm.toFixed(1)} SRM`
                  : `${stats.stats.colorEbc.toFixed(1)} EBC`}
              </Text>
            </View>
          </View>
        ) : !loadingStats && stats?.statsError ? (
          <Text style={styles.muted}>{stats.statsError}</Text>
        ) : !loadingStats ? (
          <Text style={styles.muted}>Stats unavailable for this recipe version.</Text>
        ) : null}

        {stats && stats.alphaAcidFromInventory.length > 0 ? (
          <View style={styles.aaBox} testID="batch-inventory-aa-overrides">
            <Text style={styles.aaTitle}>Hop Alpha Acid From Reserved Lots</Text>
            {stats.alphaAcidFromInventory.map((ov) => (
              <Text key={`${ov.itemId}-${ov.hop}`} style={styles.aaItem}>
                • {ov.hop}: {ov.alphaAcidPct}% AA (from reserved inventory lot)
              </Text>
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  changeBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    gap: spacing.sm,
  },
  changeTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  flexCol: { flex: 1, minWidth: 160, gap: 2 },
  group: { gap: 4 },
  groupLabel: { fontSize: 13, fontWeight: "700", color: colors.success },
  lineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
    paddingVertical: 4,
  },
  lineName: { fontSize: 14, fontWeight: "600", color: colors.text },
  reservedQty: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.success,
    fontVariant: ["tabular-nums"],
  },
  shortBox: {
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    gap: 4,
  },
  shortTitle: { fontSize: 13, fontWeight: "700", color: colors.accentPressed },
  shortQty: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.error,
    fontVariant: ["tabular-nums"],
  },
  muted: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  list: { gap: spacing.xs },
  resRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  statePill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  stateReserved: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  stateUsed: { backgroundColor: colors.successSoft, borderColor: colors.success },
  stateReleased: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  statePillText: { fontSize: 12, fontWeight: "700", textTransform: "capitalize" },
  stateReservedText: { color: colors.accentPressed },
  stateUsedText: { color: colors.success },
  stateReleasedText: { color: colors.textMuted },
  statsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statChip: {
    minWidth: 88,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  statLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted },
  statVal: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  aaBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.success,
    gap: 4,
  },
  aaTitle: { fontSize: 13, fontWeight: "700", color: colors.success },
  aaItem: { fontSize: 13, color: colors.text },
});
