// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { CatalogItem } from "../../api/catalog";
import type {
  EquipmentCondition,
  EquipmentItem,
  EquipmentItemInput,
  EquipmentItemPatch,
} from "../../api/equipment";
import { useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { radii, spacing, type ThemeColors } from "../../theme";
import { parseNumber, useOnUnitSystemChange } from "../calculators/parseNumber";
import { CatalogPicker } from "../recipes/CatalogPicker";
import { Banner, Button, Card, SegmentedControl, TextField } from "../ui";
import {
  absorptionDisplayToSi,
  absorptionSiToDisplay,
  EQUIPMENT_CONDITIONS,
  formatEditableNumber,
  volumeDisplayToSi,
  volumeSiToDisplay,
} from "./equipmentUnits";

type ConditionChoice = "none" | EquipmentCondition;

const CONDITION_OPTIONS: readonly { value: ConditionChoice; label: string }[] = [
  { value: "none", label: "Unset" },
  ...EQUIPMENT_CONDITIONS,
];

type NumericFieldKey =
  | "batchSizeL"
  | "boilSizeL"
  | "kettleVolumeL"
  | "kettleLossL"
  | "boilRateLPerHr"
  | "mashTunVolumeL"
  | "grainAbsorptionLPerKg";

const POSITIVE_FIELDS: readonly NumericFieldKey[] = [
  "batchSizeL",
  "boilSizeL",
  "kettleVolumeL",
  "mashTunVolumeL",
];

function initialNumericStrings(
  item: EquipmentItem | null,
  unitSystem: "us" | "metric",
): Record<NumericFieldKey, string> {
  const vol = (n: number | null | undefined) =>
    n != null ? formatEditableNumber(volumeSiToDisplay(n, unitSystem)) : "";
  const abs = (n: number | null | undefined) =>
    n != null ? formatEditableNumber(absorptionSiToDisplay(n, unitSystem)) : "";
  return {
    batchSizeL: vol(item?.batchSizeL),
    boilSizeL: vol(item?.boilSizeL),
    kettleVolumeL: vol(item?.kettleVolumeL),
    kettleLossL: vol(item?.kettleLossL),
    boilRateLPerHr: vol(item?.boilRateLPerHr),
    mashTunVolumeL: vol(item?.mashTunVolumeL),
    grainAbsorptionLPerKg: abs(item?.grainAbsorptionLPerKg),
  };
}

export interface EquipmentEditorCardProps {
  serverUrl: string | null;
  authToken: string | null;
  breweryId: string | null;
  workspaceLabel: string;
  item?: EquipmentItem | null;
  saving?: boolean;
  onCreate?: (input: EquipmentItemInput) => Promise<void>;
  onUpdate?: (id: string, patch: EquipmentItemPatch) => Promise<void>;
  onCancel?: () => void;
  customFetch?: typeof fetch;
}

export function EquipmentEditorCard({
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
}: EquipmentEditorCardProps) {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();

  const [name, setName] = useState(item?.name ?? "");
  const [catalogId, setCatalogId] = useState(item?.catalogId ?? "");
  const [type, setType] = useState(item?.type ?? "");
  const [condition, setCondition] = useState<ConditionChoice>(item?.condition ?? "none");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [nums, setNums] = useState<Record<NumericFieldKey, string>>(() =>
    initialNumericStrings(item, unitSystem),
  );
  const [dirtyNums, setDirtyNums] = useState<Record<NumericFieldKey, boolean>>({
    batchSizeL: !item,
    boilSizeL: !item,
    kettleVolumeL: !item,
    kettleLossL: !item,
    boilRateLPerHr: !item,
    mashTunVolumeL: !item,
    grainAbsorptionLPerKg: !item,
  });
  const [showCatalogPicker, setShowCatalogPicker] = useState(false);
  const [showDimensions, setShowDimensions] = useState(
    Boolean(
      item &&
        (item.batchSizeL != null ||
          item.kettleVolumeL != null ||
          item.boilSizeL != null ||
          item.mashTunVolumeL != null ||
          item.boilRateLPerHr != null ||
          item.kettleLossL != null ||
          item.grainAbsorptionLPerKg != null),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useOnUnitSystemChange(unitSystem, (nextSystem) => {
    const prevSystem = nextSystem === "us" ? "metric" : "us";
    setNums((prev) => {
      const next = { ...prev };
      const keys = Object.keys(prev) as NumericFieldKey[];
      for (const k of keys) {
        if (item && !dirtyNums[k]) {
          const orig = item[k];
          next[k] =
            orig != null
              ? formatEditableNumber(
                  k === "grainAbsorptionLPerKg"
                    ? absorptionSiToDisplay(orig, nextSystem)
                    : volumeSiToDisplay(orig, nextSystem),
                )
              : "";
          continue;
        }
        const parsed = parseNumber(prev[k]);
        if (parsed === null) continue;
        const si =
          k === "grainAbsorptionLPerKg"
            ? absorptionDisplayToSi(parsed, prevSystem)
            : volumeDisplayToSi(parsed, prevSystem);
        next[k] = formatEditableNumber(
          k === "grainAbsorptionLPerKg"
            ? absorptionSiToDisplay(si, nextSystem)
            : volumeSiToDisplay(si, nextSystem),
        );
      }
      return next;
    });
  });

  const handleNumericChange = (key: NumericFieldKey, val: string) => {
    setNums((prev) => ({ ...prev, [key]: val }));
    setDirtyNums((prev) => ({ ...prev, [key]: true }));
  };

  const handleCatalogSelect = (picked: CatalogItem) => {
    if (picked.catalog !== "equipment") return;
    setCatalogId(picked.id);
    if (!name.trim()) setName(picked.name);
    if (picked.category && !type.trim()) setType(picked.category);
    setNums({
      batchSizeL:
        picked.batchSizeL != null
          ? formatEditableNumber(volumeSiToDisplay(picked.batchSizeL, unitSystem))
          : "",
      boilSizeL:
        picked.boilSizeL != null
          ? formatEditableNumber(volumeSiToDisplay(picked.boilSizeL, unitSystem))
          : "",
      kettleVolumeL:
        picked.kettleVolumeL != null
          ? formatEditableNumber(volumeSiToDisplay(picked.kettleVolumeL, unitSystem))
          : "",
      kettleLossL:
        picked.kettleLossL != null
          ? formatEditableNumber(volumeSiToDisplay(picked.kettleLossL, unitSystem))
          : "",
      boilRateLPerHr:
        picked.boilRateLPerHr != null
          ? formatEditableNumber(volumeSiToDisplay(picked.boilRateLPerHr, unitSystem))
          : "",
      mashTunVolumeL:
        picked.mashTunVolumeL != null
          ? formatEditableNumber(volumeSiToDisplay(picked.mashTunVolumeL, unitSystem))
          : "",
      grainAbsorptionLPerKg:
        picked.grainAbsorptionLPerKg != null
          ? formatEditableNumber(absorptionSiToDisplay(picked.grainAbsorptionLPerKg, unitSystem))
          : "",
    });
    setDirtyNums({
      batchSizeL: true,
      boilSizeL: true,
      kettleVolumeL: true,
      kettleLossL: true,
      boilRateLPerHr: true,
      mashTunVolumeL: true,
      grainAbsorptionLPerKg: true,
    });
    setShowDimensions(true);
    setShowCatalogPicker(false);
    setError(null);
  };

  const parseDimension = (
    key: NumericFieldKey,
    label: string,
  ): { value: number | null; error?: string } => {
    const raw = nums[key].trim();
    if (!raw) return { value: null };
    const parsed = parseNumber(raw);
    if (parsed === null) {
      return { value: null, error: `${label} must be a valid number.` };
    }
    const mustBePositive = POSITIVE_FIELDS.includes(key);
    if (mustBePositive ? parsed <= 0 : parsed < 0) {
      return {
        value: null,
        error: mustBePositive
          ? `${label} must be greater than zero.`
          : `${label} must be zero or greater.`,
      };
    }
    const si =
      key === "grainAbsorptionLPerKg"
        ? absorptionDisplayToSi(parsed, unitSystem)
        : volumeDisplayToSi(parsed, unitSystem);
    if (key === "grainAbsorptionLPerKg" && si > 5) {
      return { value: null, error: `${label} exceeds the allowed maximum.` };
    }
    return { value: si };
  };

  const handleSubmit = async () => {
    setError(null);
    setNotice(null);

    const trimmedName = name.trim();
    const trimmedCatalog = catalogId.trim();
    if (!trimmedName && !trimmedCatalog) {
      setError("Enter an equipment name or start from a catalog item.");
      return;
    }

    const fieldDefs: readonly [NumericFieldKey, string][] = [
      ["batchSizeL", "Batch size"],
      ["boilSizeL", "Boil size"],
      ["kettleVolumeL", "Kettle volume"],
      ["kettleLossL", "Kettle loss"],
      ["boilRateLPerHr", "Boil-off rate"],
      ["mashTunVolumeL", "Mash tun volume"],
      ["grainAbsorptionLPerKg", "Grain absorption"],
    ];

    const parsedDims: Partial<Record<NumericFieldKey, number | null>> = {};
    for (const [key, label] of fieldDefs) {
      if (item && !dirtyNums[key]) continue;
      const res = parseDimension(key, label);
      if (res.error) {
        setError(res.error);
        return;
      }
      parsedDims[key] = res.value;
    }

    const nextType = type.trim() || null;
    const nextCondition: EquipmentCondition | null = condition === "none" ? null : condition;
    const nextNotes = notes.trim() || null;

    try {
      if (item && onUpdate) {
        const patch: EquipmentItemPatch = {};
        if (trimmedName && trimmedName !== item.name) patch.name = trimmedName;
        if (nextType !== item.type) patch.type = nextType;
        if (nextCondition !== item.condition) patch.condition = nextCondition;
        if (nextNotes !== item.notes) patch.notes = nextNotes;
        for (const [key] of fieldDefs) {
          if (!dirtyNums[key]) continue;
          const nextVal = parsedDims[key] ?? null;
          const prevVal = item[key];
          const changed =
            (nextVal === null) !== (prevVal === null) ||
            (nextVal !== null && prevVal !== null && Math.abs(nextVal - prevVal) > 1e-9);
          if (changed) patch[key] = nextVal;
        }
        if (Object.keys(patch).length === 0) {
          setNotice("No changes to save.");
          return;
        }
        await onUpdate(item.id, patch);
      } else if (onCreate) {
        const payload: EquipmentItemInput = {
          ...(trimmedName ? { name: trimmedName } : {}),
          ...(trimmedCatalog ? { catalogId: trimmedCatalog } : {}),
          ...(breweryId ? { breweryId } : {}),
          ...(nextType ? { type: nextType } : {}),
          ...(nextCondition ? { condition: nextCondition } : {}),
          ...(nextNotes ? { notes: nextNotes } : {}),
        };
        for (const [key] of fieldDefs) {
          const val = parsedDims[key];
          if (val != null) payload[key] = val;
        }
        await onCreate(payload);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save equipment item.");
    }
  };

  const volUnit = unitSystem === "us" ? "gal" : "L";
  const rateUnit = unitSystem === "us" ? "gal/hr" : "L/hr";
  const absUnit = unitSystem === "us" ? "qt/lb" : "L/kg";

  return (
    <View testID="equipment-editor-card">
      <Card>
        <View style={styles.header}>
          <View style={styles.headerCol}>
            <Text style={styles.title}>{item ? `Edit ${item.name}` : "Add Equipment Item"}</Text>
            <Text style={styles.subtitle}>
              Workspace: {workspaceLabel} · Volumes shown in{" "}
              {unitSystem === "us" ? "US units" : "Metric units"} (stored in SI)
            </Text>
          </View>
          {onCancel ? (
            <Button
              label="Cancel"
              variant="ghost"
              onPress={onCancel}
              testID="equipment-editor-cancel"
            />
          ) : null}
        </View>

        {!item && serverUrl ? (
          <View style={styles.catalogBlock}>
            <View style={styles.catalogRow}>
              <Text style={styles.fieldLabel}>
                {catalogId ? `Catalog: ${catalogId}` : "Optional: start from equipment catalog"}
              </Text>
              <View style={styles.inlineButtons}>
                {catalogId ? (
                  <Button
                    label="Clear"
                    variant="ghost"
                    onPress={() => setCatalogId("")}
                    testID="equipment-clear-catalog"
                  />
                ) : null}
                <Button
                  label={showCatalogPicker ? "Hide catalog" : "Browse catalog"}
                  variant="secondary"
                  onPress={() => setShowCatalogPicker((v) => !v)}
                  testID="equipment-toggle-catalog"
                />
              </View>
            </View>
            {showCatalogPicker ? (
              <CatalogPicker
                serverUrl={serverUrl}
                authToken={authToken}
                catalog="equipment"
                label="Search equipment catalog"
                placeholder="Search Anvil, Grainfather, 10 gal kettle..."
                onSelect={handleCatalogSelect}
                testIDPrefix="equip-catalog"
                unitSystem={unitSystem}
                {...(customFetch ? { customFetch } : {})}
              />
            ) : null}
          </View>
        ) : null}

        <View style={styles.row}>
          <View style={styles.fieldHalf}>
            <TextField
              label="Equipment Name"
              value={name}
              onChangeText={setName}
              placeholder="e.g. 10 gal Brew Kettle, Tilt Pro, 5 gal Carboy"
              autoCapitalize="words"
              testID="equipment-name-input"
            />
          </View>
          <View style={styles.fieldHalf}>
            <TextField
              label="Type (optional)"
              value={type}
              onChangeText={setType}
              placeholder="e.g. Kettle, Fermenter, Chiller, Keg"
              autoCapitalize="words"
              testID="equipment-type-input"
            />
          </View>
        </View>

        <View style={styles.conditionBlock}>
          <Text style={styles.fieldLabel}>Condition</Text>
          <SegmentedControl
            options={CONDITION_OPTIONS}
            value={condition}
            onChange={setCondition}
            accessibilityLabel="Equipment condition"
            compact
          />
        </View>

        <TextField
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Fittings, valve details, storage notes..."
          autoCapitalize="sentences"
          testID="equipment-notes-input"
        />

        <View style={styles.dimensionsHeader}>
          <Text style={styles.fieldLabel}>Optional Brewery Specs ({volUnit})</Text>
          <Button
            label={showDimensions ? "Hide specs" : "Add capacities / specs"}
            variant="ghost"
            onPress={() => setShowDimensions((v) => !v)}
            testID="equipment-toggle-dimensions"
          />
        </View>

        {showDimensions ? (
          <View style={styles.row} testID="equipment-dimensions-fields">
            <View style={styles.fieldThird}>
              <TextField
                label="Batch Size"
                value={nums.batchSizeL}
                onChangeText={(v) => handleNumericChange("batchSizeL", v)}
                unit={volUnit}
                keyboardType="decimal-pad"
                placeholder="5.0"
                testID="equipment-batch-size-input"
              />
            </View>
            <View style={styles.fieldThird}>
              <TextField
                label="Kettle Volume"
                value={nums.kettleVolumeL}
                onChangeText={(v) => handleNumericChange("kettleVolumeL", v)}
                unit={volUnit}
                keyboardType="decimal-pad"
                placeholder="10.0"
                testID="equipment-kettle-volume-input"
              />
            </View>
            <View style={styles.fieldThird}>
              <TextField
                label="Boil Size"
                value={nums.boilSizeL}
                onChangeText={(v) => handleNumericChange("boilSizeL", v)}
                unit={volUnit}
                keyboardType="decimal-pad"
                placeholder="6.5"
                testID="equipment-boil-size-input"
              />
            </View>
            <View style={styles.fieldThird}>
              <TextField
                label="Kettle Loss"
                value={nums.kettleLossL}
                onChangeText={(v) => handleNumericChange("kettleLossL", v)}
                unit={volUnit}
                keyboardType="decimal-pad"
                placeholder="0.5"
                testID="equipment-kettle-loss-input"
              />
            </View>
            <View style={styles.fieldThird}>
              <TextField
                label="Boil-Off Rate"
                value={nums.boilRateLPerHr}
                onChangeText={(v) => handleNumericChange("boilRateLPerHr", v)}
                unit={rateUnit}
                keyboardType="decimal-pad"
                placeholder="1.0"
                testID="equipment-boil-rate-input"
              />
            </View>
            <View style={styles.fieldThird}>
              <TextField
                label="Mash Tun Volume"
                value={nums.mashTunVolumeL}
                onChangeText={(v) => handleNumericChange("mashTunVolumeL", v)}
                unit={volUnit}
                keyboardType="decimal-pad"
                placeholder="10.0"
                testID="equipment-mash-tun-input"
              />
            </View>
            <View style={styles.fieldThird}>
              <TextField
                label="Grain Absorption"
                value={nums.grainAbsorptionLPerKg}
                onChangeText={(v) => handleNumericChange("grainAbsorptionLPerKg", v)}
                unit={absUnit}
                keyboardType="decimal-pad"
                placeholder={unitSystem === "us" ? "0.5" : "1.0"}
                testID="equipment-absorption-input"
              />
            </View>
          </View>
        ) : null}

        {error ? <Banner tone="error" message={error} testID="equipment-editor-error" /> : null}
        {notice ? <Banner tone="info" message={notice} testID="equipment-editor-notice" /> : null}

        <Button
          label={saving ? "Saving..." : item ? "Save equipment" : "Add equipment"}
          disabled={saving}
          onPress={() => void handleSubmit()}
          testID="equipment-editor-submit"
        />
      </Card>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    headerCol: { flex: 1, gap: 2 },
    title: { fontSize: 18, fontWeight: "700", color: colors.text },
    subtitle: { fontSize: 12, color: colors.textMuted },
    fieldLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
    catalogBlock: {
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.sm,
    },
    catalogRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    inlineButtons: { flexDirection: "row", gap: spacing.xs },
    row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    fieldHalf: { flex: 1, minWidth: 200 },
    fieldThird: { flex: 1, minWidth: 150 },
    conditionBlock: { gap: spacing.xs },
    dimensionsHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap",
      gap: spacing.xs,
    },
  });
