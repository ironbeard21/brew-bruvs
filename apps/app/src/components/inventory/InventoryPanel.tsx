// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Brewery } from "../../api/breweries";
import {
  type CreateInventoryItemInput,
  type InventoryItem,
  type InventoryItemPatch,
  useCreateInventoryItem,
  useDeleteInventoryItem,
  useInventory,
  useLowStock,
  useUpdateInventoryItem,
} from "../../api/inventory";
import { notifyLowStockItems } from "../../notifications";
import { canPerformOnOwner, canWriteBrewery, ROLE_LABELS } from "../../state/permissions";
import { useUnits } from "../../state/units";
import { colors, radii, spacing } from "../../theme";
import { OwnerBadge } from "../OwnerBadge";
import { ShareDialog } from "../sharing/ShareDialog";
import { Banner, Button, Card, SegmentedControl, TextField } from "../ui";
import { InventoryEditorCard } from "./InventoryEditorCard";
import { formatInventoryAmount, isLowStock } from "./inventoryUnits";

type StockFilter = "all" | "low" | "reserved";

const STOCK_FILTER_OPTIONS: readonly { value: StockFilter; label: string }[] = [
  { value: "all", label: "All items" },
  { value: "low", label: "Low stock" },
  { value: "reserved", label: "Reserved" },
];

export interface InventoryPanelProps {
  serverUrl: string;
  authToken: string | null;
  currentUserId: string;
  activeBrewery: Brewery | null;
  breweries: readonly Brewery[];
  editingItem?: InventoryItem | null;
  onEditingItemChange?: (item: InventoryItem | null) => void;
  onOpenShoppingList?: () => void;
  customFetch?: typeof fetch;
}

export function InventoryPanel({
  serverUrl,
  authToken,
  currentUserId,
  activeBrewery,
  breweries,
  editingItem: editingItemProp,
  onEditingItemChange,
  onOpenShoppingList,
  customFetch,
}: InventoryPanelProps) {
  const { unitSystem } = useUnits();
  const breweryId = activeBrewery?.id ?? null;
  const workspaceLabel = activeBrewery ? activeBrewery.name : "Me (personal)";
  const canCreate = !activeBrewery || canWriteBrewery(activeBrewery.role);

  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [locationFilter, setLocationFilter] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [localEditingItem, setLocalEditingItem] = useState<InventoryItem | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [sharingItemId, setSharingItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [alertNotice, setAlertNotice] = useState<string | null>(null);

  const editingItem = editingItemProp !== undefined ? editingItemProp : localEditingItem;
  const setEditingItem = onEditingItemChange ?? setLocalEditingItem;

  const inventoryQuery = useInventory(
    serverUrl,
    authToken,
    { breweryId, q: search, enabled: true },
    customFetch,
  );
  const lowStockQuery = useLowStock(
    serverUrl,
    authToken,
    { breweryId, enabled: true },
    customFetch,
  );
  const createItem = useCreateInventoryItem(serverUrl, authToken, customFetch);
  const updateItem = useUpdateInventoryItem(serverUrl, authToken, customFetch);
  const deleteItem = useDeleteInventoryItem(serverUrl, authToken, customFetch);

  const lowStockItems = useMemo(() => lowStockQuery.data ?? [], [lowStockQuery.data]);

  // Trigger deduplicated local notification when items newly drop below their low-stock threshold.
  useEffect(() => {
    if (!lowStockQuery.isSuccess) return;
    let cancelled = false;
    void notifyLowStockItems(lowStockItems, unitSystem, {
      scopeKey: `${serverUrl}::${breweryId ?? "me"}`,
      workspaceLabel,
    }).then((res) => {
      if (cancelled || res.newlyAlerted.length === 0) return;
      setAlertNotice(
        res.delivered
          ? `Local low-stock alert sent for ${res.newlyAlerted.map((i) => i.name).join(", ")}.`
          : `Low stock alert: ${res.newlyAlerted.map((i) => i.name).join(", ")} dropped below threshold.`,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [lowStockQuery.isSuccess, lowStockItems, unitSystem, serverUrl, breweryId, workspaceLabel]);

  const items = inventoryQuery.data ?? [];
  const sharingItem = sharingItemId ? (items.find((i) => i.id === sharingItemId) ?? null) : null;

  const locations = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      const loc = item.location?.trim();
      if (loc) set.add(loc);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (stockFilter === "low" && !isLowStock(item)) return false;
      if (stockFilter === "reserved" && item.reserved <= 0) return false;
      if (locationFilter && item.location?.trim() !== locationFilter) return false;
      return true;
    });
  }, [items, stockFilter, locationFilter]);

  const handleCreate = async (input: CreateInventoryItemInput) => {
    setActionError(null);
    await createItem.mutateAsync(input);
    setShowAddForm(false);
  };

  const handleUpdate = async (id: string, patch: InventoryItemPatch) => {
    setActionError(null);
    await updateItem.mutateAsync({ id, patch });
    setEditingItem(null);
  };

  const handleDelete = async (id: string) => {
    setActionError(null);
    try {
      await deleteItem.mutateAsync(id);
      setConfirmDeleteId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not delete item.");
    }
  };

  const handleCheckLowStockAlerts = async () => {
    setAlertNotice(null);
    const current = lowStockQuery.data ?? [];
    if (current.length === 0) {
      setAlertNotice("No items are currently below their low-stock threshold.");
      return;
    }
    // Reuse the stable workspace scope key with force=true so manual checks don't leak keys in storage.
    const res = await notifyLowStockItems(current, unitSystem, {
      scopeKey: `${serverUrl}::${breweryId ?? "me"}`,
      workspaceLabel,
      requestPermission: true,
      force: true,
    });
    setAlertNotice(
      res.delivered
        ? `Sent local notification for ${current.length} low-stock ${current.length === 1 ? "item" : "items"}.`
        : `${current.length} low-stock ${current.length === 1 ? "item" : "items"} found. Enable device/browser notifications to receive local alerts.`,
    );
  };

  return (
    <View style={styles.root} testID="inventory-panel">
      {/* Search, Filters & Actions */}
      <Card>
        <View style={styles.topRow}>
          <View style={styles.searchWrap}>
            <TextField
              label="Scan or Search Inventory"
              value={search}
              onChangeText={setSearch}
              placeholder="Search name, catalog ID, lot/barcode, or location..."
              testID="inventory-search-input"
            />
          </View>
          <View style={styles.topButtons}>
            {search.trim() ? (
              <Button
                label="Clear"
                variant="secondary"
                onPress={() => setSearch("")}
                testID="inventory-search-clear"
              />
            ) : null}
            {canCreate ? (
              <Button
                label={showAddForm ? "Close editor" : "+ Add item"}
                variant={showAddForm ? "secondary" : "primary"}
                onPress={() => {
                  setEditingItem(null);
                  setShowAddForm((v) => !v);
                }}
                testID="inventory-add-button"
              />
            ) : null}
          </View>
        </View>

        {activeBrewery && !canCreate ? (
          <Banner
            tone="info"
            message={`Viewing ${activeBrewery.name} inventory as ${ROLE_LABELS[activeBrewery.role]}. Only Owners and Brewers can edit brewery inventory.`}
            testID="inventory-readonly-role-banner"
          />
        ) : null}

        <View style={styles.filtersRow}>
          <SegmentedControl
            options={STOCK_FILTER_OPTIONS}
            value={stockFilter}
            onChange={setStockFilter}
            accessibilityLabel="Filter inventory status"
            compact
          />
          {lowStockItems.length > 0 ? (
            <View style={styles.lowStockBar}>
              <Button
                label={`Low stock (${lowStockItems.length})`}
                variant="secondary"
                onPress={() => {
                  if (onOpenShoppingList) {
                    onOpenShoppingList();
                  } else {
                    setStockFilter("low");
                  }
                }}
                testID="inventory-low-stock-shortcut"
              />
              <Button
                label="Notify low stock"
                variant="ghost"
                onPress={() => void handleCheckLowStockAlerts()}
                testID="inventory-notify-low-stock"
              />
            </View>
          ) : null}
        </View>

        {locations.length > 0 ? (
          <View style={styles.locationRow} testID="inventory-location-chips">
            <Text style={styles.chipPrefix}>Location:</Text>
            <Pressable
              onPress={() => setLocationFilter(null)}
              accessibilityRole="button"
              accessibilityState={{ selected: locationFilter === null }}
              style={[styles.chip, locationFilter === null && styles.chipActive]}
            >
              <Text style={[styles.chipText, locationFilter === null && styles.chipTextActive]}>
                All
              </Text>
            </Pressable>
            {locations.map((loc) => {
              const selected = locationFilter === loc;
              return (
                <Pressable
                  key={loc}
                  onPress={() => setLocationFilter(selected ? null : loc)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  testID={`inventory-location-chip-${loc}`}
                  style={[styles.chip, selected && styles.chipActive]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextActive]}>{loc}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {alertNotice ? (
          <Banner tone="info" message={alertNotice} testID="low-stock-alert-banner" />
        ) : null}
        {actionError ? (
          <Banner tone="error" message={actionError} testID="inventory-error" />
        ) : null}
      </Card>

      {/* Add or Edit Editor */}
      {showAddForm && canCreate && !editingItem ? (
        <InventoryEditorCard
          key={`add-${breweryId ?? "me"}`}
          serverUrl={serverUrl}
          authToken={authToken}
          breweryId={breweryId}
          workspaceLabel={workspaceLabel}
          saving={createItem.isPending}
          onCreate={handleCreate}
          onCancel={() => setShowAddForm(false)}
          {...(customFetch ? { customFetch } : {})}
        />
      ) : null}

      {editingItem ? (
        <InventoryEditorCard
          key={`edit-${editingItem.id}`}
          serverUrl={serverUrl}
          authToken={authToken}
          breweryId={breweryId}
          workspaceLabel={workspaceLabel}
          item={editingItem}
          saving={updateItem.isPending}
          onUpdate={handleUpdate}
          onCancel={() => setEditingItem(null)}
          {...(customFetch ? { customFetch } : {})}
        />
      ) : null}

      {/* Inventory List */}
      {inventoryQuery.isPending ? (
        <Card>
          <Banner tone="info" message="Loading inventory..." />
        </Card>
      ) : inventoryQuery.isError ? (
        <Card>
          <Banner
            tone="error"
            message={
              inventoryQuery.error instanceof Error
                ? inventoryQuery.error.message
                : "Could not load inventory."
            }
          />
        </Card>
      ) : filteredItems.length === 0 ? (
        <Card>
          <Text style={styles.emptyTitle} testID="inventory-empty">
            {items.length === 0 ? "No inventory items yet" : "No items match your filters"}
          </Text>
          <Text style={styles.muted}>
            {items.length === 0
              ? `Add malt, hops, yeast, honey, or additives to ${workspaceLabel}. Batches automatically reserve ingredients when started.`
              : "Try clearing your search or status filter."}
          </Text>
          {items.length === 0 && canCreate && !showAddForm ? (
            <Button
              label="Add first item"
              onPress={() => setShowAddForm(true)}
              testID="inventory-empty-add-button"
            />
          ) : null}
        </Card>
      ) : (
        <View style={styles.list} testID="inventory-list">
          {filteredItems.map((item) => {
            const low = isLowStock(item);
            const canEdit = canPerformOnOwner(currentUserId, breweries, item.owner, "edit");
            const canDelete = canPerformOnOwner(currentUserId, breweries, item.owner, "delete");
            const canShare = canPerformOnOwner(currentUserId, breweries, item.owner, "share");
            return (
              <Card key={item.id} style={low ? styles.lowStockCard : undefined}>
                <View style={styles.itemHeader} testID={`inventory-item-${item.id}`}>
                  <View style={styles.itemTitleCol}>
                    <View style={styles.titleRow}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <OwnerBadge
                        owner={item.owner}
                        currentUserId={currentUserId}
                        breweries={breweries}
                        testID={`inventory-owner-badge-${item.id}`}
                      />
                      {low ? (
                        <View style={styles.lowPill} testID={`low-stock-badge-${item.id}`}>
                          <Text style={styles.lowPillText}>Low stock</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.qtyRow}>
                      <Text style={styles.qtyPrimary} testID={`inventory-available-${item.id}`}>
                        Available:{" "}
                        {formatInventoryAmount(item.available, item.quantityUnit, unitSystem)}
                      </Text>
                      <Text style={styles.qtySecondary} testID={`inventory-onhand-${item.id}`}>
                        On hand:{" "}
                        {formatInventoryAmount(item.quantity, item.quantityUnit, unitSystem)}
                      </Text>
                      {item.reserved > 0 ? (
                        <Text style={styles.qtyReserved} testID={`inventory-reserved-${item.id}`}>
                          Reserved:{" "}
                          {formatInventoryAmount(item.reserved, item.quantityUnit, unitSystem)}
                        </Text>
                      ) : null}
                      {item.lowStockThreshold != null ? (
                        <Text style={styles.qtySecondary}>
                          Alert below:{" "}
                          {formatInventoryAmount(
                            item.lowStockThreshold,
                            item.quantityUnit,
                            unitSystem,
                          )}
                        </Text>
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.itemActions}>
                    {canShare ? (
                      <Button
                        label="Share"
                        variant="ghost"
                        onPress={() => setSharingItemId(item.id)}
                        accessibilityLabel={`Share ${item.name}`}
                        testID={`inventory-share-${item.id}`}
                      />
                    ) : null}
                    {canEdit ? (
                      <Button
                        label="Edit"
                        variant="secondary"
                        onPress={() => {
                          setShowAddForm(false);
                          setEditingItem(item);
                        }}
                        accessibilityLabel={`Edit ${item.name}`}
                        testID={`inventory-edit-${item.id}`}
                      />
                    ) : null}
                    {canDelete ? (
                      confirmDeleteId === item.id ? (
                        <>
                          <Button
                            label={deleteItem.isPending ? "Deleting..." : "Confirm delete"}
                            variant="secondary"
                            disabled={deleteItem.isPending}
                            onPress={() => void handleDelete(item.id)}
                            testID={`inventory-confirm-delete-${item.id}`}
                          />
                          <Button
                            label="Cancel"
                            variant="ghost"
                            onPress={() => setConfirmDeleteId(null)}
                          />
                        </>
                      ) : (
                        <Button
                          label="Delete"
                          variant="ghost"
                          onPress={() => setConfirmDeleteId(item.id)}
                          accessibilityLabel={`Delete ${item.name}`}
                          testID={`inventory-delete-${item.id}`}
                        />
                      )
                    ) : null}
                  </View>
                </View>

                <View style={styles.metaPills}>
                  {item.location ? (
                    <Text style={styles.metaPill}>Location: {item.location}</Text>
                  ) : null}
                  {item.lot ? <Text style={styles.metaPill}>Lot: {item.lot}</Text> : null}
                  {item.catalogId ? (
                    <Text style={styles.metaPill}>Catalog: {item.catalogId}</Text>
                  ) : null}
                  {item.alphaAcidPct != null ? (
                    <Text style={styles.metaPill}>{item.alphaAcidPct}% AA</Text>
                  ) : null}
                  {item.bestBefore ? (
                    <Text style={styles.metaPill}>Best before: {item.bestBefore}</Text>
                  ) : null}
                  {item.purchasedOn ? (
                    <Text style={styles.metaPill}>Purchased: {item.purchasedOn}</Text>
                  ) : null}
                </View>

                {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}
              </Card>
            );
          })}
        </View>
      )}

      {sharingItem ? (
        <ShareDialog
          open
          onClose={() => setSharingItemId(null)}
          serverUrl={serverUrl}
          authToken={authToken}
          resourceType="inventory_item"
          resourceId={sharingItem.id}
          resourceName={sharingItem.name}
          owner={sharingItem.owner}
          canManage={canPerformOnOwner(currentUserId, breweries, sharingItem.owner, "share")}
          breweries={breweries}
          {...(customFetch ? { customFetch } : {})}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  searchWrap: { flex: 1, minWidth: 220 },
  topButtons: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  filtersRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  lowStockBar: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  chipPrefix: { fontSize: 12, fontWeight: "700", color: colors.textMuted },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
  },
  chipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  chipText: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  chipTextActive: { color: colors.accentPressed, fontWeight: "700" },
  list: { gap: spacing.sm },
  lowStockCard: { borderColor: colors.error },
  itemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  itemTitleCol: { flex: 1, minWidth: 210, gap: 6 },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
  itemName: { fontSize: 17, fontWeight: "700", color: colors.text },
  lowPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.errorSoft,
    borderWidth: 1,
    borderColor: colors.error,
  },
  lowPillText: { fontSize: 12, fontWeight: "700", color: colors.error },
  qtyRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, alignItems: "center" },
  qtyPrimary: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  qtySecondary: {
    fontSize: 13,
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
  },
  qtyReserved: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.accentPressed,
    fontVariant: ["tabular-nums"],
  },
  itemActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" },
  metaPills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metaPill: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  notes: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  muted: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
});
