// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { CatalogItem, CatalogKind } from "../../api/catalog";
import type {
  CreateInventoryItemInput,
  InventoryItem,
  InventoryItemPatch,
} from "../../api/inventory";
import { useUnits } from "../../state/units";
import { colors, radii, spacing } from "../../theme";
import { parseNumber, useOnUnitSystemChange } from "../calculators/parseNumber";
import { CatalogPicker } from "../recipes/CatalogPicker";
import { Banner, Button, Card, SegmentedControl, TextField } from "../ui";
import {
  convertDisplayUnitForSystem,
  type DisplayUnit,
  defaultDisplayUnitFor,
  displayUnitsForSystem,
  displayUnitToSi,
  formatNumberInput,
  siToDisplayValue,
  siUnitOf,
} from "./inventoryUnits";

const CATALOG_KINDS: readonly { value: CatalogKind; label: string }[] = [
  { value: "fermentables", label: "Fermentables" },
  { value: "hops", label: "Hops" },
  { value: "yeasts", label: "Yeasts" },
  { value: "miscs", label: "Misc" },
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface InventoryEditorCardProps {
  serverUrl: string | null;
  authToken: string | null;
  breweryId: string | null;
  workspaceLabel: string;
  item?: InventoryItem | null;
  saving?: boolean;
  onCreate?: (input: CreateInventoryItemInput) => Promise<void>;
  onUpdate?: (id: string, patch: InventoryItemPatch) => Promise<void>;
  onCancel?: () => void;
  customFetch?: typeof fetch;
}

export function InventoryEditorCard({
  serverUrl,
  authToken,
  breweryId,
  workspaceLabel,
  item = null,
  saving = false,
  onCreate,
  onUpdate,
  onCancel,
  customFetch,
}: InventoryEditorCardProps) {
  const { unitSystem } = useUnits();

  const initialUnit: DisplayUnit = item
    ? defaultDisplayUnitFor(item.quantityUnit, unitSystem, item.quantity)
    : unitSystem === "us"
      ? "lb"
      : "kg";

  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>(initialUnit);
  const [name, setName] = useState(item?.name ?? "");
  const [catalogId, setCatalogId] = useState(item?.catalogId ?? "");
  const [quantityText, setQuantityText] = useState(
    item ? formatNumberInput(siToDisplayValue(item.quantity, initialUnit), initialUnit) : "",
  );
  const [thresholdText, setThresholdText] = useState(
    item && item.lowStockThreshold != null
      ? formatNumberInput(siToDisplayValue(item.lowStockThreshold, initialUnit), initialUnit)
      : "",
  );
  const [lot, setLot] = useState(item?.lot ?? "");
  const [location, setLocation] = useState(item?.location ?? "");
  const [alphaAcidText, setAlphaAcidText] = useState(
    item?.alphaAcidPct != null ? String(item.alphaAcidPct) : "",
  );
  const [purchasedOn, setPurchasedOn] = useState(item?.purchasedOn ?? "");
  const [bestBefore, setBestBefore] = useState(item?.bestBefore ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");

  const [showCatalogPicker, setShowCatalogPicker] = useState(false);
  const [catalogKind, setCatalogKind] = useState<CatalogKind>("fermentables");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useOnUnitSystemChange(unitSystem, (nextSystem) => {
    const nextUnit = convertDisplayUnitForSystem(displayUnit, nextSystem);
    if (nextUnit === displayUnit) return;
    const qty = parseNumber(quantityText);
    if (qty !== null) {
      const si = displayUnitToSi(qty, displayUnit).amount;
      setQuantityText(formatNumberInput(siToDisplayValue(si, nextUnit), nextUnit));
    }
    const thresh = parseNumber(thresholdText);
    if (thresh !== null) {
      const si = displayUnitToSi(thresh, displayUnit).amount;
      setThresholdText(formatNumberInput(siToDisplayValue(si, nextUnit), nextUnit));
    }
    setDisplayUnit(nextUnit);
  });

  const handleSelectUnit = (nextUnit: DisplayUnit) => {
    if (nextUnit === displayUnit) return;
    // Convert existing numeric text cleanly when switching within the same physical dimension
    if (siUnitOf(nextUnit) === siUnitOf(displayUnit)) {
      const qty = parseNumber(quantityText);
      if (qty !== null) {
        const si = displayUnitToSi(qty, displayUnit).amount;
        setQuantityText(formatNumberInput(siToDisplayValue(si, nextUnit), nextUnit));
      }
      const thresh = parseNumber(thresholdText);
      if (thresh !== null) {
        const si = displayUnitToSi(thresh, displayUnit).amount;
        setThresholdText(formatNumberInput(siToDisplayValue(si, nextUnit), nextUnit));
      }
    }
    setDisplayUnit(nextUnit);
  };

  const handleCatalogSelect = (picked: CatalogItem) => {
    setName(picked.name);
    setCatalogId(picked.id);
    if (picked.catalog === "hops") {
      setDisplayUnit(unitSystem === "us" ? "oz" : "g");
      if (picked.alphaAcidPct != null && !alphaAcidText.trim()) {
        setAlphaAcidText(String(picked.alphaAcidPct));
      }
    } else if (picked.catalog === "yeasts") {
      setDisplayUnit("each");
    } else if (picked.catalog === "fermentables") {
      setDisplayUnit(unitSystem === "us" ? "lb" : "kg");
    } else if (picked.catalog === "miscs") {
      setDisplayUnit(unitSystem === "us" ? "oz" : "g");
    }
    setShowCatalogPicker(false);
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);
    setNotice(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter an ingredient or item name.");
      return;
    }

    const qtyDisplay = parseNumber(quantityText);
    if (qtyDisplay === null || qtyDisplay < 0) {
      setError("Enter a non-negative quantity.");
      return;
    }
    const convertedQty = displayUnitToSi(qtyDisplay, displayUnit);

    let thresholdSi: number | null = null;
    if (thresholdText.trim()) {
      const tVal = parseNumber(thresholdText);
      if (tVal === null || tVal < 0) {
        setError("Low-stock threshold must be a non-negative number.");
        return;
      }
      thresholdSi = displayUnitToSi(tVal, displayUnit).amount;
    }

    let alphaAcidPct: number | null = null;
    if (alphaAcidText.trim()) {
      const aa = parseNumber(alphaAcidText);
      if (aa === null || aa < 0 || aa > 100) {
        setError("Hop alpha acid must be between 0 and 100%.");
        return;
      }
      alphaAcidPct = aa;
    }

    const purchasedTrim = purchasedOn.trim();
    if (purchasedTrim && !ISO_DATE_RE.test(purchasedTrim)) {
      setError("Purchased date must use YYYY-MM-DD format.");
      return;
    }
    const bestTrim = bestBefore.trim();
    if (bestTrim && !ISO_DATE_RE.test(bestTrim)) {
      setError("Best-before date must use YYYY-MM-DD format.");
      return;
    }

    const nextCatalogId = catalogId.trim() || null;
    const nextLot = lot.trim() || null;
    const nextLocation = location.trim() || null;
    const nextPurchased = purchasedTrim || null;
    const nextBest = bestTrim || null;
    const nextNotes = notes.trim() || null;

    try {
      if (item && onUpdate) {
        const patch: InventoryItemPatch = {};
        if (trimmedName !== item.name) patch.name = trimmedName;
        if (nextCatalogId !== item.catalogId) patch.catalogId = nextCatalogId;
        if (Math.abs(convertedQty.amount - item.quantity) > 1e-9) {
          patch.quantity = convertedQty.amount;
        }
        if (convertedQty.unit !== item.quantityUnit) patch.quantityUnit = convertedQty.unit;
        if (nextLot !== item.lot) patch.lot = nextLot;
        if (nextLocation !== item.location) patch.location = nextLocation;
        if (alphaAcidPct !== item.alphaAcidPct) patch.alphaAcidPct = alphaAcidPct;
        if (nextPurchased !== item.purchasedOn) patch.purchasedOn = nextPurchased;
        if (nextBest !== item.bestBefore) patch.bestBefore = nextBest;
        const prevThresh = item.lowStockThreshold;
        const threshChanged =
          (thresholdSi === null) !== (prevThresh === null) ||
          (thresholdSi !== null &&
            prevThresh !== null &&
            Math.abs(thresholdSi - prevThresh) > 1e-9);
        if (threshChanged) patch.lowStockThreshold = thresholdSi;
        if (nextNotes !== item.notes) patch.notes = nextNotes;

        if (Object.keys(patch).length === 0) {
          setNotice("No changes to save.");
          return;
        }
        await onUpdate(item.id, patch);
      } else if (onCreate) {
        const input: CreateInventoryItemInput = {
          name: trimmedName,
          quantity: convertedQty.amount,
          quantityUnit: convertedQty.unit,
          ...(breweryId ? { breweryId } : {}),
          ...(nextCatalogId ? { catalogId: nextCatalogId } : {}),
          ...(nextLot ? { lot: nextLot } : {}),
          ...(nextLocation ? { location: nextLocation } : {}),
          ...(alphaAcidPct !== null ? { alphaAcidPct } : {}),
          ...(nextPurchased ? { purchasedOn: nextPurchased } : {}),
          ...(nextBest ? { bestBefore: nextBest } : {}),
          ...(thresholdSi !== null ? { lowStockThreshold: thresholdSi } : {}),
          ...(nextNotes ? { notes: nextNotes } : {}),
        };
        await onCreate(input);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save inventory item.");
    }
  };

  const unitOptions = displayUnitsForSystem(unitSystem).map((u) => ({
    value: u.value,
    label: u.label,
    accessibilityLabel: `Unit ${u.label}`,
  }));
  const activeUnitLabel =
    displayUnitsForSystem(unitSystem).find((u) => u.value === displayUnit)?.label ?? displayUnit;

  return (
    <Card>
      <View style={styles.root} testID="inventory-editor-card">
        <View style={styles.headerRow}>
          <View style={styles.flexCol}>
            <Text style={styles.title}>{item ? `Edit ${item.name}` : "Add Inventory Item"}</Text>
            <Text style={styles.muted}>
              {item
                ? `Saved in SI (${siUnitOf(displayUnit)}); enter values in your chosen units.`
                : `Adding to ${workspaceLabel}. Values convert to SI automatically.`}
            </Text>
          </View>
          {onCancel ? (
            <Button
              label="Cancel"
              variant="ghost"
              onPress={onCancel}
              testID="inventory-editor-cancel"
            />
          ) : null}
        </View>

        {serverUrl ? (
          <View style={styles.catalogBox}>
            <View style={styles.headerRow}>
              <Text style={styles.subTitle}>Catalog Match (optional)</Text>
              <Button
                label={showCatalogPicker ? "Hide catalog" : "Pick from catalog"}
                variant="secondary"
                onPress={() => setShowCatalogPicker((v) => !v)}
                testID="inventory-toggle-catalog-picker"
              />
            </View>
            {catalogId ? (
              <View style={styles.catalogPillRow}>
                <Text style={styles.catalogPillText} testID="inventory-linked-catalog-id">
                  Linked: {catalogId}
                </Text>
                <Button
                  label="Clear"
                  variant="ghost"
                  onPress={() => setCatalogId("")}
                  testID="inventory-clear-catalog-id"
                />
              </View>
            ) : (
              <Text style={styles.metaText}>
                Linking a catalog ingredient lets batches match this lot automatically when
                reserving stock.
              </Text>
            )}
            {showCatalogPicker ? (
              <View style={styles.catalogSearchWrap}>
                <SegmentedControl
                  options={CATALOG_KINDS}
                  value={catalogKind}
                  onChange={setCatalogKind}
                  accessibilityLabel="Catalog ingredient category"
                  compact
                />
                <CatalogPicker
                  serverUrl={serverUrl}
                  authToken={authToken}
                  catalog={catalogKind}
                  label={`Search ${catalogKind}`}
                  placeholder="Type ingredient name or alias (e.g. Zeus, Pale Malt, US-05)..."
                  onSelect={handleCatalogSelect}
                  testIDPrefix="inv-catalog"
                  {...(customFetch ? { customFetch } : {})}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        <TextField
          label="Item Name"
          value={name}
          onChangeText={setName}
          placeholder="Pale Malt (2 Row) US"
          autoCapitalize="words"
          testID="inventory-name-input"
        />

        <View style={styles.unitGroup}>
          <Text style={styles.fieldLabel}>Unit</Text>
          <SegmentedControl
            options={unitOptions}
            value={displayUnit}
            onChange={handleSelectUnit}
            accessibilityLabel="Inventory quantity unit"
            compact
          />
        </View>

        <View style={styles.fieldRow}>
          <View style={styles.halfField}>
            <TextField
              label="Quantity on hand"
              value={quantityText}
              onChangeText={setQuantityText}
              placeholder={displayUnit === "each" ? "2" : "10"}
              unit={activeUnitLabel}
              keyboardType="decimal-pad"
              testID="inventory-quantity-input"
            />
          </View>
          <View style={styles.halfField}>
            <TextField
              label="Low-stock threshold (optional)"
              value={thresholdText}
              onChangeText={setThresholdText}
              placeholder={displayUnit === "each" ? "1" : "2"}
              unit={activeUnitLabel}
              keyboardType="decimal-pad"
              testID="inventory-threshold-input"
            />
          </View>
        </View>

        <View style={styles.fieldRow}>
          <View style={styles.halfField}>
            <TextField
              label="Location (optional)"
              value={location}
              onChangeText={setLocation}
              placeholder="Freezer, Grain shelf 2"
              autoCapitalize="words"
              testID="inventory-location-input"
            />
          </View>
          <View style={styles.halfField}>
            <TextField
              label="Lot / Barcode (optional)"
              value={lot}
              onChangeText={setLot}
              placeholder="LOT-2026-04"
              testID="inventory-lot-input"
            />
          </View>
        </View>

        <View style={styles.fieldRow}>
          <View style={styles.thirdField}>
            <TextField
              label="Hop AA % (optional)"
              value={alphaAcidText}
              onChangeText={setAlphaAcidText}
              placeholder="12.5"
              unit="%"
              keyboardType="decimal-pad"
              helper="Overrides recipe AA% when reserved"
              testID="inventory-aa-input"
            />
          </View>
          <View style={styles.thirdField}>
            <TextField
              label="Purchased (YYYY-MM-DD)"
              value={purchasedOn}
              onChangeText={setPurchasedOn}
              placeholder="2026-11-01"
              testID="inventory-purchased-input"
            />
          </View>
          <View style={styles.thirdField}>
            <TextField
              label="Best before (YYYY-MM-DD)"
              value={bestBefore}
              onChangeText={setBestBefore}
              placeholder="2027-06-01"
              testID="inventory-best-before-input"
            />
          </View>
        </View>

        <TextField
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Vacuum-sealed pellet pack, crop year 2026"
          autoCapitalize="sentences"
          testID="inventory-notes-input"
        />

        {error ? <Banner tone="error" message={error} testID="inventory-editor-error" /> : null}
        {notice ? <Banner tone="info" message={notice} testID="inventory-editor-notice" /> : null}

        <View style={styles.actionsRow}>
          <Button
            label={saving ? "Saving..." : item ? "Save item" : "Add to inventory"}
            disabled={saving}
            onPress={() => void handleSubmit()}
            testID="inventory-editor-submit"
          />
          {onCancel ? <Button label="Cancel" variant="secondary" onPress={onCancel} /> : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  flexCol: { flex: 1, minWidth: 180, gap: 2 },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  subTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  fieldLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
  muted: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  metaText: { fontSize: 12, color: colors.textMuted },
  catalogBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  catalogPillRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  catalogPillText: { fontSize: 13, fontWeight: "700", color: colors.accentPressed },
  catalogSearchWrap: { gap: spacing.sm },
  unitGroup: { gap: spacing.xs },
  fieldRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  halfField: { flex: 1, minWidth: 140 },
  thirdField: { flex: 1, minWidth: 130 },
  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
