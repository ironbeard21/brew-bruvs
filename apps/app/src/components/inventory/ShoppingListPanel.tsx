// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { Brewery } from "../../api/breweries";
import { type InventoryItem, useShoppingList } from "../../api/inventory";
import { notifyLowStockItems } from "../../notifications";
import { canPerformOnOwner } from "../../state/permissions";
import { useUnits } from "../../state/units";
import { colors, radii, spacing } from "../../theme";
import { OwnerBadge } from "../OwnerBadge";
import { Banner, Button, Card } from "../ui";
import { formatInventoryAmount, formatShoppingListText } from "./inventoryUnits";

async function copyChecklist(text: string): Promise<string> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return "Shopping list copied to clipboard.";
    } catch {
      return "Clipboard access blocked — review the list below.";
    }
  }
  return "Shopping list ready below.";
}

export interface ShoppingListPanelProps {
  serverUrl: string;
  authToken: string | null;
  currentUserId: string;
  activeBrewery: Brewery | null;
  breweries: readonly Brewery[];
  onOpenBatch?: (batchId: string) => void;
  onRestockItem?: (item: InventoryItem) => void;
  customFetch?: typeof fetch;
}

export function ShoppingListPanel({
  serverUrl,
  authToken,
  currentUserId,
  activeBrewery,
  breweries,
  onOpenBatch,
  onRestockItem,
  customFetch,
}: ShoppingListPanelProps) {
  const { unitSystem } = useUnits();
  const breweryId = activeBrewery?.id ?? null;
  const workspaceLabel = activeBrewery ? activeBrewery.name : "Me (personal)";

  const [notice, setNotice] = useState<string | null>(null);

  const shoppingQuery = useShoppingList(
    serverUrl,
    authToken,
    { breweryId, enabled: true },
    customFetch,
  );

  if (shoppingQuery.isPending) {
    return (
      <Card>
        <Banner tone="info" message="Calculating shopping list..." />
      </Card>
    );
  }

  if (shoppingQuery.isError || !shoppingQuery.data) {
    return (
      <Card>
        <Banner
          tone="error"
          message={
            shoppingQuery.error instanceof Error
              ? shoppingQuery.error.message
              : "Could not load shopping list."
          }
        />
      </Card>
    );
  }

  const shopping = shoppingQuery.data;
  const totalCount = shopping.short.length + shopping.lowStock.length;

  const handleCopy = async () => {
    const text = formatShoppingListText(shopping, unitSystem, workspaceLabel);
    setNotice(await copyChecklist(text));
  };

  const handleNotifyLowStock = async () => {
    if (shopping.lowStock.length === 0) {
      setNotice("No items are currently below their low-stock threshold.");
      return;
    }
    const res = await notifyLowStockItems(shopping.lowStock, unitSystem, {
      scopeKey: `${serverUrl}::${breweryId ?? "me"}::shopping-${Date.now()}`,
      workspaceLabel,
      requestPermission: true,
    });
    setNotice(
      res.delivered
        ? `Sent local low-stock alert for ${shopping.lowStock.length} ${shopping.lowStock.length === 1 ? "item" : "items"}.`
        : `${shopping.lowStock.length} low-stock ${shopping.lowStock.length === 1 ? "item" : "items"} listed below. Grant notification permission on your device for local alerts.`,
    );
  };

  return (
    <View style={styles.root} testID="shopping-list-panel">
      <Card>
        <View style={styles.headerRow}>
          <View style={styles.flexCol}>
            <Text style={styles.title}>Shopping List — {workspaceLabel}</Text>
            <Text style={styles.muted}>
              Combines ingredient shortfalls from planned batches with items below their low-stock
              threshold.
            </Text>
          </View>
          <View style={styles.actionsRow}>
            {totalCount > 0 ? (
              <Button
                label="Copy list"
                variant="secondary"
                onPress={() => void handleCopy()}
                testID="shopping-list-copy-button"
              />
            ) : null}
            <Button
              label="Local low-stock alert"
              variant="ghost"
              onPress={() => void handleNotifyLowStock()}
              testID="shopping-list-notify-button"
            />
          </View>
        </View>
        {notice ? <Banner tone="info" message={notice} testID="shopping-list-notice" /> : null}
      </Card>

      {totalCount === 0 ? (
        <Card>
          <Text style={styles.emptyTitle} testID="shopping-list-empty">
            All stocked up
          </Text>
          <Text style={styles.muted}>
            No planned batches are short of ingredients and no items are below their low-stock
            threshold.
          </Text>
        </Card>
      ) : null}

      {/* Shortfalls for planned batches */}
      <Card>
        <Text style={styles.sectionTitle}>Short for Planned Batches ({shopping.short.length})</Text>
        {shopping.short.length === 0 ? (
          <Text style={styles.muted} testID="shopping-short-empty">
            Every planned batch has enough ingredients available on hand.
          </Text>
        ) : (
          <View style={styles.list} testID="shopping-short-list">
            {shopping.short.map((entry, idx) => (
              <View
                key={`${entry.catalogId ?? entry.name}-${entry.unit}`}
                style={styles.row}
                testID={`shopping-short-item-${idx}`}
              >
                <View style={styles.rowHeader}>
                  <Text style={styles.itemName}>{entry.name}</Text>
                  <View style={styles.shortBadge}>
                    <Text style={styles.shortBadgeText}>
                      Need {formatInventoryAmount(entry.short, entry.unit, unitSystem)}
                    </Text>
                  </View>
                </View>
                {entry.batches.length > 0 ? (
                  <View style={styles.batchChips}>
                    <Text style={styles.metaText}>For:</Text>
                    {entry.batches.map((b) => (
                      <Pressable
                        key={b.id}
                        disabled={!onOpenBatch}
                        onPress={() => onOpenBatch?.(b.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Open planned batch ${b.name}`}
                        testID={`shopping-batch-link-${b.id}`}
                        style={styles.batchChip}
                      >
                        <Text style={styles.batchChipText}>{b.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </Card>

      {/* Low-stock threshold items */}
      <Card>
        <Text style={styles.sectionTitle}>Low Stock Items ({shopping.lowStock.length})</Text>
        {shopping.lowStock.length === 0 ? (
          <Text style={styles.muted} testID="shopping-lowstock-empty">
            No items are below their low-stock threshold.
          </Text>
        ) : (
          <View style={styles.list} testID="shopping-lowstock-list">
            {shopping.lowStock.map((item) => {
              const canEdit = canPerformOnOwner(currentUserId, breweries, item.owner, "edit");
              return (
                <View key={item.id} style={styles.row} testID={`shopping-lowstock-item-${item.id}`}>
                  <View style={styles.rowHeader}>
                    <View style={styles.titleRow}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <OwnerBadge
                        owner={item.owner}
                        currentUserId={currentUserId}
                        breweries={breweries}
                        testID={`shopping-owner-badge-${item.id}`}
                      />
                    </View>
                    {canEdit && onRestockItem ? (
                      <Button
                        label="Restock / Edit"
                        variant="secondary"
                        onPress={() => onRestockItem(item)}
                        testID={`shopping-restock-${item.id}`}
                      />
                    ) : null}
                  </View>
                  <Text style={styles.metaText}>
                    Available:{" "}
                    {formatInventoryAmount(item.available, item.quantityUnit, unitSystem)}
                    {item.lowStockThreshold != null
                      ? ` · Threshold: ${formatInventoryAmount(item.lowStockThreshold, item.quantityUnit, unitSystem)}`
                      : ""}
                    {item.location ? ` · ${item.location}` : ""}
                  </Text>
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
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  flexCol: { flex: 1, minWidth: 200, gap: 4 },
  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  muted: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  metaText: { fontSize: 13, color: colors.textMuted },
  list: { gap: spacing.sm },
  row: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
  itemName: { fontSize: 15, fontWeight: "700", color: colors.text },
  shortBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  shortBadgeText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.accentPressed,
    fontVariant: ["tabular-nums"],
  },
  batchChips: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  batchChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  batchChipText: { fontSize: 12, fontWeight: "700", color: colors.accentPressed },
});
