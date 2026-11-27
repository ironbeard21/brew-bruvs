// SPDX-License-Identifier: AGPL-3.0-or-later
import { StyleSheet, Text, View } from "react-native";
import type { Brewery } from "../../api/breweries";
import { type InventoryItem, type QuantityUnit, useInventory } from "../../api/inventory";
import { useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { radii, spacing, type ThemeColors } from "../../theme";
import { formatInventoryAmount } from "../inventory/inventoryUnits";
import { OwnerBadge } from "../OwnerBadge";
import { Banner, Card } from "../ui";

export function formatInventoryQuantity(
  amount: number,
  unit: QuantityUnit,
  unitSystem: "us" | "metric",
): string {
  return formatInventoryAmount(amount, unit, unitSystem);
}

export interface InventoryPreviewCardProps {
  serverUrl: string | null;
  authToken: string | null;
  breweryId: string | null;
  title: string;
  currentUserId: string | null;
  breweries: readonly Pick<Brewery, "id" | "name">[];
  customFetch?: typeof fetch;
}

export function InventoryPreviewCard({
  serverUrl,
  authToken,
  breweryId,
  title,
  currentUserId,
  breweries,
  customFetch,
}: InventoryPreviewCardProps) {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();
  const inventoryQuery = useInventory(
    serverUrl,
    authToken,
    { breweryId, enabled: Boolean(serverUrl && currentUserId) },
    customFetch,
  );

  const items: readonly InventoryItem[] = inventoryQuery.data ?? [];

  return (
    <Card>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.count} testID="inventory-preview-count">
          {items.length} {items.length === 1 ? "item" : "items"}
        </Text>
      </View>

      {inventoryQuery.isPending ? (
        <Banner tone="info" message="Loading inventory..." />
      ) : inventoryQuery.isError ? (
        <Banner
          tone="error"
          message={
            inventoryQuery.error instanceof Error
              ? inventoryQuery.error.message
              : "Could not load inventory."
          }
        />
      ) : items.length === 0 ? (
        <Text style={styles.muted} testID="inventory-preview-empty">
          No inventory items in this workspace yet.
        </Text>
      ) : (
        <View style={styles.list} testID="inventory-preview-list">
          {items.map((item) => (
            <View key={item.id} style={styles.row} testID={`inventory-preview-item-${item.id}`}>
              <View style={styles.rowMain}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemMeta}>
                  On hand: {formatInventoryQuantity(item.quantity, item.quantityUnit, unitSystem)}
                  {" · "}Available:{" "}
                  {formatInventoryQuantity(item.available, item.quantityUnit, unitSystem)}
                  {item.location ? ` · ${item.location}` : ""}
                </Text>
              </View>
              <OwnerBadge
                owner={item.owner}
                currentUserId={currentUserId}
                breweries={breweries}
                testID={`inventory-owner-badge-${item.id}`}
              />
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.sm,
    },
    title: { fontSize: 18, fontWeight: "700", color: colors.text },
    count: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
    muted: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
    list: { gap: spacing.xs },
    row: {
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
    rowMain: { flex: 1, minWidth: 180, gap: 2 },
    itemName: { fontSize: 15, fontWeight: "700", color: colors.text },
    itemMeta: { fontSize: 13, color: colors.textMuted },
  });
