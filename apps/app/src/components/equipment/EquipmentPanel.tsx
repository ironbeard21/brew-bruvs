// SPDX-License-Identifier: AGPL-3.0-or-later
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  type Brewery,
  type BreweryDetail,
  type BreweryMember,
  fetchBreweryDetail,
} from "../../api/breweries";
import {
  type EquipmentItem,
  type EquipmentItemInput,
  type EquipmentItemPatch,
  useCreateEquipmentItem,
  useDeleteEquipmentItem,
  useEquipmentItems,
  useSetEquipmentHolder,
  useUpdateEquipmentItem,
} from "../../api/equipment";
import { canPerformOnOwner, canWriteBrewery, ROLE_LABELS } from "../../state/permissions";
import { useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { radii, spacing, type ThemeColors } from "../../theme";
import { OwnerBadge, RoleBadge } from "../OwnerBadge";
import { ShareDialog } from "../sharing/ShareDialog";
import { Banner, Button, Card, SegmentedControl, TextField } from "../ui";
import { EquipmentEditorCard } from "./EquipmentEditorCard";
import {
  CONDITION_LABELS,
  formatBoilRate,
  formatEquipmentVolume,
  formatGrainAbsorption,
} from "./equipmentUnits";

type ScopeMode = "workspace" | "all" | "mine";
type LoanFilter = "all" | "lent" | "available";

const LOAN_FILTER_OPTIONS: readonly { value: LoanFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "lent", label: "On loan" },
  { value: "available", label: "Available" },
];

export interface EquipmentPanelProps {
  serverUrl: string;
  authToken: string | null;
  currentUserId: string;
  activeBrewery: Brewery | null;
  breweries: readonly Brewery[];
  customFetch?: typeof fetch;
}

export function EquipmentPanel({
  serverUrl,
  authToken,
  currentUserId,
  activeBrewery,
  breweries,
  customFetch,
}: EquipmentPanelProps) {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();
  const activeBreweryId = activeBrewery?.id ?? null;
  const workspaceLabel = activeBrewery ? activeBrewery.name : "Me (personal)";
  const canCreate = !activeBrewery || canWriteBrewery(activeBrewery.role);

  const [scope, setScope] = useState<ScopeMode>(activeBreweryId ? "workspace" : "all");
  const [search, setSearch] = useState("");
  const [loanFilter, setLoanFilter] = useState<LoanFilter>("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingItem, setEditingItem] = useState<EquipmentItem | null>(null);
  const [lendingItemId, setLendingItemId] = useState<string | null>(null);
  const [sharingItemId, setSharingItemId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setScope(activeBreweryId ? "workspace" : "all");
  }, [activeBreweryId]);

  const queryBreweryId = activeBrewery && scope === "workspace" ? activeBrewery.id : null;
  const equipmentQuery = useEquipmentItems(
    serverUrl,
    authToken,
    { breweryId: queryBreweryId, enabled: true },
    customFetch,
  );
  const createItem = useCreateEquipmentItem(serverUrl, authToken, customFetch);
  const updateItem = useUpdateEquipmentItem(serverUrl, authToken, customFetch);
  const deleteItem = useDeleteEquipmentItem(serverUrl, authToken, customFetch);
  const setHolder = useSetEquipmentHolder(serverUrl, authToken, customFetch);

  const items = equipmentQuery.data ?? [];

  // Load member lists for every brewery that owns items shown here (plus active brewery) so
  // "Held by" displays real member names and the lending picker has every brewery member.
  const breweryIdsToLoad = useMemo(() => {
    const ids = new Set<string>();
    const memberBreweryIds = new Set(breweries.map((b) => b.id));
    if (activeBreweryId && memberBreweryIds.has(activeBreweryId)) {
      ids.add(activeBreweryId);
    }
    for (const item of items) {
      if (item.owner.type === "brewery" && memberBreweryIds.has(item.owner.id)) {
        ids.add(item.owner.id);
      }
    }
    return [...ids];
  }, [activeBreweryId, breweries, items]);

  const breweryDetailQueries = useQueries({
    queries: breweryIdsToLoad.map((id) => ({
      queryKey: ["brewery-detail", serverUrl, id],
      enabled: Boolean(serverUrl && id),
      retry: false,
      queryFn: () => fetchBreweryDetail(serverUrl, authToken, id, customFetch),
    })),
  });

  const membersByBrewery = useMemo(() => {
    const map = new Map<string, readonly BreweryMember[]>();
    for (let i = 0; i < breweryIdsToLoad.length; i += 1) {
      const id = breweryIdsToLoad[i];
      const detail = breweryDetailQueries[i]?.data as BreweryDetail | undefined;
      if (id && detail) {
        map.set(id, detail.members);
      }
    }
    return map;
  }, [breweryIdsToLoad, breweryDetailQueries]);

  const resolveHolderName = (item: EquipmentItem): string | null => {
    if (!item.heldByUserId) return null;
    if (item.heldByUserId === currentUserId) return "You";
    if (item.owner.type === "brewery") {
      const members = membersByBrewery.get(item.owner.id);
      const found = members?.find((m) => m.userId === item.heldByUserId);
      if (found) return found.displayName;
    }
    return "Brewery member";
  };

  const hasBreweryItems = items.some((i) => i.owner.type === "brewery");

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      if (!activeBrewery && scope === "mine") {
        if (item.owner.type !== "user" || item.owner.id !== currentUserId) return false;
      }
      if (loanFilter === "lent" && !item.heldByUserId) return false;
      if (loanFilter === "available" && (item.owner.type !== "brewery" || item.heldByUserId)) {
        return false;
      }
      if (!needle) return true;
      const holderName =
        item.heldByUserId && item.owner.type === "brewery"
          ? (membersByBrewery
              .get(item.owner.id)
              ?.find((m) => m.userId === item.heldByUserId)
              ?.displayName.toLowerCase() ?? "")
          : "";
      return (
        item.name.toLowerCase().includes(needle) ||
        (item.type?.toLowerCase().includes(needle) ?? false) ||
        (item.condition
          ? CONDITION_LABELS[item.condition].toLowerCase().includes(needle)
          : false) ||
        (item.notes?.toLowerCase().includes(needle) ?? false) ||
        holderName.includes(needle)
      );
    });
  }, [items, activeBrewery, scope, currentUserId, loanFilter, search, membersByBrewery]);

  const sharingItem = sharingItemId ? (items.find((i) => i.id === sharingItemId) ?? null) : null;

  const scopeOptions: readonly { value: ScopeMode; label: string }[] = activeBrewery
    ? [
        { value: "workspace", label: activeBrewery.name },
        { value: "all", label: "All visible" },
      ]
    : [
        { value: "all", label: "All visible" },
        { value: "mine", label: "Mine only" },
      ];

  const handleCreate = async (input: EquipmentItemInput) => {
    setActionError(null);
    setActionNotice(null);
    await createItem.mutateAsync(input);
    setShowAddForm(false);
    setActionNotice("Equipment item added.");
  };

  const handleUpdate = async (id: string, patch: EquipmentItemPatch) => {
    setActionError(null);
    setActionNotice(null);
    await updateItem.mutateAsync({ id, patch });
    setEditingItem(null);
    setActionNotice("Equipment item updated.");
  };

  const handleDelete = async (id: string) => {
    setActionError(null);
    setActionNotice(null);
    try {
      await deleteItem.mutateAsync(id);
      setConfirmDeleteId(null);
      setActionNotice("Equipment item deleted.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not delete equipment item.");
    }
  };

  const handleSetHolder = async (
    item: EquipmentItem,
    heldByUserId: string | null,
    memberName?: string,
  ) => {
    setActionError(null);
    setActionNotice(null);
    try {
      await setHolder.mutateAsync({ id: item.id, heldByUserId });
      setLendingItemId(null);
      setActionNotice(
        heldByUserId
          ? `Lent ${item.name} to ${memberName ?? "member"}.`
          : `Marked ${item.name} as returned.`,
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update holder.");
    }
  };

  return (
    <View style={styles.root} testID="equipment-panel">
      <Card>
        <View style={styles.topRow}>
          <View style={styles.searchWrap}>
            <TextField
              label="Search Equipment"
              value={search}
              onChangeText={setSearch}
              placeholder="Search name, type, condition, holder, or notes..."
              testID="equipment-search-input"
            />
          </View>
          <View style={styles.topButtons}>
            {search.trim() ? (
              <Button
                label="Clear"
                variant="secondary"
                onPress={() => setSearch("")}
                testID="equipment-search-clear"
              />
            ) : null}
            {canCreate ? (
              <Button
                label={showAddForm ? "Close editor" : "+ Add equipment"}
                variant={showAddForm ? "secondary" : "primary"}
                onPress={() => {
                  setEditingItem(null);
                  setShowAddForm((v) => !v);
                }}
                testID="equipment-add-button"
              />
            ) : null}
          </View>
        </View>

        {activeBrewery && !canCreate ? (
          <Banner
            tone="info"
            message={`Viewing ${activeBrewery.name} equipment as ${ROLE_LABELS[activeBrewery.role]}. Only Owners and Brewers can add, edit, or lend brewery equipment.`}
            testID="equipment-readonly-role-banner"
          />
        ) : null}

        <View style={styles.filtersRow}>
          <SegmentedControl
            options={scopeOptions}
            value={scope}
            onChange={setScope}
            accessibilityLabel="Filter equipment by workspace"
            compact
          />
          {hasBreweryItems ? (
            <SegmentedControl
              options={LOAN_FILTER_OPTIONS}
              value={loanFilter}
              onChange={setLoanFilter}
              accessibilityLabel="Filter equipment by lending status"
              compact
            />
          ) : null}
        </View>

        {actionNotice ? (
          <Banner tone="success" message={actionNotice} testID="equipment-notice" />
        ) : null}
        {actionError ? (
          <Banner tone="error" message={actionError} testID="equipment-error" />
        ) : null}
      </Card>

      {showAddForm && canCreate && !editingItem ? (
        <EquipmentEditorCard
          key={`add-${activeBreweryId ?? "me"}`}
          serverUrl={serverUrl}
          authToken={authToken}
          breweryId={activeBreweryId}
          workspaceLabel={workspaceLabel}
          saving={createItem.isPending}
          onCreate={handleCreate}
          onCancel={() => setShowAddForm(false)}
          {...(customFetch ? { customFetch } : {})}
        />
      ) : null}

      {editingItem ? (
        <EquipmentEditorCard
          key={`edit-${editingItem.id}`}
          serverUrl={serverUrl}
          authToken={authToken}
          breweryId={editingItem.owner.type === "brewery" ? editingItem.owner.id : null}
          workspaceLabel={workspaceLabel}
          item={editingItem}
          saving={updateItem.isPending}
          onUpdate={handleUpdate}
          onCancel={() => setEditingItem(null)}
          {...(customFetch ? { customFetch } : {})}
        />
      ) : null}

      {equipmentQuery.isPending ? (
        <Card>
          <Banner tone="info" message="Loading equipment..." />
        </Card>
      ) : equipmentQuery.isError ? (
        <Card>
          <Banner
            tone="error"
            message={
              equipmentQuery.error instanceof Error
                ? equipmentQuery.error.message
                : "Could not load equipment."
            }
          />
        </Card>
      ) : filteredItems.length === 0 ? (
        <Card>
          <Text style={styles.emptyTitle} testID="equipment-empty">
            {items.length === 0 ? "No equipment items yet" : "No equipment matches your filters"}
          </Text>
          <Text style={styles.muted}>
            {items.length === 0
              ? `Track kettles, fermenters, chillers, and shared club gear in ${workspaceLabel}. Brewery equipment supports lending and shows who currently holds each item.`
              : "Try clearing your search or lending filter."}
          </Text>
          {items.length === 0 && canCreate && !showAddForm ? (
            <Button
              label="Add first equipment item"
              onPress={() => setShowAddForm(true)}
              testID="equipment-empty-add-button"
            />
          ) : null}
        </Card>
      ) : (
        <View style={styles.list} testID="equipment-list">
          {filteredItems.map((item) => {
            const isBreweryItem = item.owner.type === "brewery";
            const canEdit = canPerformOnOwner(currentUserId, breweries, item.owner, "edit");
            const canDelete = canPerformOnOwner(currentUserId, breweries, item.owner, "delete");
            const canShare = canPerformOnOwner(currentUserId, breweries, item.owner, "share");
            const holderName = resolveHolderName(item);
            const members = isBreweryItem ? (membersByBrewery.get(item.owner.id) ?? []) : [];
            const lendingOpen = lendingItemId === item.id;

            return (
              <Card key={item.id}>
                <View style={styles.itemHeader} testID={`equipment-item-${item.id}`}>
                  <View style={styles.itemTitleCol}>
                    <View style={styles.titleRow}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <OwnerBadge
                        owner={item.owner}
                        currentUserId={currentUserId}
                        breweries={breweries}
                        testID={`equipment-owner-badge-${item.id}`}
                      />
                      {item.type ? (
                        <View style={styles.typePill}>
                          <Text style={styles.typePillText}>{item.type}</Text>
                        </View>
                      ) : null}
                      {item.condition ? (
                        <View
                          style={[
                            styles.conditionPill,
                            (item.condition === "needs_repair" || item.condition === "retired") &&
                              styles.conditionPillWarn,
                          ]}
                          testID={`equipment-condition-${item.id}`}
                        >
                          <Text
                            style={[
                              styles.conditionPillText,
                              (item.condition === "needs_repair" || item.condition === "retired") &&
                                styles.conditionPillTextWarn,
                            ]}
                          >
                            {CONDITION_LABELS[item.condition]}
                          </Text>
                        </View>
                      ) : null}
                      {item.visibility !== "private" ? (
                        <View style={styles.typePill}>
                          <Text style={styles.typePillText}>{item.visibility}</Text>
                        </View>
                      ) : null}
                    </View>

                    {isBreweryItem ? (
                      <View style={styles.holderRow} testID={`equipment-holder-${item.id}`}>
                        <View
                          style={[
                            styles.holderBadge,
                            item.heldByUserId ? styles.holderBadgeLent : styles.holderBadgeHome,
                          ]}
                        >
                          <Text
                            style={[
                              styles.holderBadgeText,
                              item.heldByUserId
                                ? styles.holderBadgeTextLent
                                : styles.holderBadgeTextHome,
                            ]}
                          >
                            {holderName ? `Held by ${holderName}` : "Available at brewery"}
                          </Text>
                        </View>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.itemActions}>
                    {isBreweryItem && canEdit ? (
                      <>
                        <Button
                          label={
                            lendingOpen ? "Close" : item.heldByUserId ? "Change holder" : "Lend"
                          }
                          variant="secondary"
                          onPress={() => setLendingItemId(lendingOpen ? null : item.id)}
                          accessibilityLabel={`${item.heldByUserId ? "Change holder for" : "Lend"} ${item.name}`}
                          testID={`equipment-lend-${item.id}`}
                        />
                        {item.heldByUserId ? (
                          <Button
                            label="Return"
                            variant="ghost"
                            disabled={setHolder.isPending}
                            onPress={() => void handleSetHolder(item, null)}
                            accessibilityLabel={`Mark ${item.name} returned`}
                            testID={`equipment-return-${item.id}`}
                          />
                        ) : null}
                      </>
                    ) : null}
                    {canShare ? (
                      <Button
                        label="Share"
                        variant="ghost"
                        onPress={() => setSharingItemId(item.id)}
                        accessibilityLabel={`Share ${item.name}`}
                        testID={`equipment-share-${item.id}`}
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
                        testID={`equipment-edit-${item.id}`}
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
                            testID={`equipment-confirm-delete-${item.id}`}
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
                          testID={`equipment-delete-${item.id}`}
                        />
                      )
                    ) : null}
                  </View>
                </View>

                {lendingOpen && isBreweryItem && canEdit ? (
                  <View style={styles.lendingBox} testID={`equipment-lend-picker-${item.id}`}>
                    <Text style={styles.lendingTitle}>Who holds {item.name}?</Text>
                    {members.length === 0 ? (
                      <Text style={styles.muted}>Loading brewery members...</Text>
                    ) : (
                      <View style={styles.memberPickerList}>
                        {members.map((member) => {
                          const selected = item.heldByUserId === member.userId;
                          return (
                            <Pressable
                              key={member.userId}
                              disabled={setHolder.isPending}
                              onPress={() =>
                                void handleSetHolder(item, member.userId, member.displayName)
                              }
                              accessibilityRole="button"
                              accessibilityLabel={`Lend ${item.name} to ${member.displayName}`}
                              accessibilityState={{ selected }}
                              testID={`equipment-lend-member-${item.id}-${member.userId}`}
                              style={[styles.memberOption, selected && styles.memberOptionSelected]}
                            >
                              <Text
                                style={[
                                  styles.memberOptionName,
                                  selected && styles.memberOptionNameSelected,
                                ]}
                              >
                                {member.displayName}
                                {member.userId === currentUserId ? " (you)" : ""}
                              </Text>
                              <RoleBadge role={member.role} />
                            </Pressable>
                          );
                        })}
                        {item.heldByUserId ? (
                          <Button
                            label="Mark returned to brewery"
                            variant="secondary"
                            disabled={setHolder.isPending}
                            onPress={() => void handleSetHolder(item, null)}
                            testID={`equipment-lend-return-${item.id}`}
                          />
                        ) : null}
                      </View>
                    )}
                  </View>
                ) : null}

                <View style={styles.metaPills}>
                  {item.batchSizeL != null ? (
                    <Text style={styles.metaPill}>
                      Batch: {formatEquipmentVolume(item.batchSizeL, unitSystem)}
                    </Text>
                  ) : null}
                  {item.kettleVolumeL != null ? (
                    <Text style={styles.metaPill}>
                      Kettle: {formatEquipmentVolume(item.kettleVolumeL, unitSystem)}
                    </Text>
                  ) : null}
                  {item.boilSizeL != null ? (
                    <Text style={styles.metaPill}>
                      Boil: {formatEquipmentVolume(item.boilSizeL, unitSystem)}
                    </Text>
                  ) : null}
                  {item.boilRateLPerHr != null ? (
                    <Text style={styles.metaPill}>
                      Boil-off: {formatBoilRate(item.boilRateLPerHr, unitSystem)}
                    </Text>
                  ) : null}
                  {item.mashTunVolumeL != null ? (
                    <Text style={styles.metaPill}>
                      Mash tun: {formatEquipmentVolume(item.mashTunVolumeL, unitSystem)}
                    </Text>
                  ) : null}
                  {item.kettleLossL != null ? (
                    <Text style={styles.metaPill}>
                      Kettle loss: {formatEquipmentVolume(item.kettleLossL, unitSystem)}
                    </Text>
                  ) : null}
                  {item.grainAbsorptionLPerKg != null ? (
                    <Text style={styles.metaPill}>
                      Absorption: {formatGrainAbsorption(item.grainAbsorptionLPerKg, unitSystem)}
                    </Text>
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
          resourceType="equipment_item"
          resourceId={sharingItem.id}
          resourceName={sharingItem.name}
          visibility={sharingItem.visibility}
          owner={sharingItem.owner}
          canManage={canPerformOnOwner(currentUserId, breweries, sharingItem.owner, "share")}
          breweries={breweries}
          {...(customFetch ? { customFetch } : {})}
        />
      ) : null}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
    list: { gap: spacing.sm },
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
    typePill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radii.pill,
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    typePillText: { fontSize: 11, fontWeight: "700", color: colors.textMuted },
    conditionPill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radii.pill,
      backgroundColor: colors.successSoft,
    },
    conditionPillWarn: {
      backgroundColor: colors.errorSoft,
    },
    conditionPillText: { fontSize: 11, fontWeight: "700", color: colors.success },
    conditionPillTextWarn: { color: colors.error },
    holderRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
    holderBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radii.pill,
      borderWidth: 1,
    },
    holderBadgeLent: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    holderBadgeHome: {
      backgroundColor: colors.surfaceSubtle,
      borderColor: colors.border,
    },
    holderBadgeText: { fontSize: 12, fontWeight: "700" },
    holderBadgeTextLent: { color: colors.accentPressed },
    holderBadgeTextHome: { color: colors.textMuted },
    itemActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" },
    lendingBox: {
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      gap: spacing.sm,
    },
    lendingTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
    memberPickerList: { gap: spacing.xs },
    memberOption: {
      minHeight: 44,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    memberOptionSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    memberOptionName: { fontSize: 14, fontWeight: "600", color: colors.text },
    memberOptionNameSelected: { color: colors.accentPressed, fontWeight: "700" },
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
      fontVariant: ["tabular-nums"],
    },
    notes: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
    emptyTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
    muted: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  });
