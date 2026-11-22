// SPDX-License-Identifier: AGPL-3.0-or-later
import { units } from "@brew-bruvs/brew-math";
import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { colors, DESKTOP_BREAKPOINT, spacing } from "../../theme";
import { Banner, Card, ResultRow, SegmentedControl, TextField } from "../ui";
import { formatFixed, parseNumber } from "./parseNumber";

type CategoryId = "gravity" | "temperature" | "mass" | "volume" | "color" | "pressure";

interface UnitDef {
  id: string;
  label: string;
  digits: number;
  toBase: (value: number) => number;
  fromBase: (base: number) => number;
}

interface CategoryDef {
  id: CategoryId;
  label: string;
  defaultUnit: string;
  defaultValue: string;
  units: readonly UnitDef[];
}

const CATEGORIES: readonly CategoryDef[] = [
  {
    id: "gravity",
    label: "Gravity",
    defaultUnit: "sg",
    defaultValue: "1.050",
    units: [
      { id: "sg", label: "SG", digits: 3, toBase: (v) => v, fromBase: (b) => b },
      {
        id: "plato",
        label: "°Plato",
        digits: 2,
        toBase: units.platoToSg,
        fromBase: units.sgToPlato,
      },
      { id: "brix", label: "°Brix", digits: 2, toBase: units.brixToSg, fromBase: units.sgToBrix },
    ],
  },
  {
    id: "temperature",
    label: "Temp",
    defaultUnit: "f",
    defaultValue: "68",
    units: [
      { id: "f", label: "°F", digits: 1, toBase: units.fToC, fromBase: units.cToF },
      { id: "c", label: "°C", digits: 1, toBase: (v) => v, fromBase: (b) => b },
    ],
  },
  {
    id: "mass",
    label: "Mass",
    defaultUnit: "lb",
    defaultValue: "10",
    units: [
      { id: "lb", label: "lb", digits: 2, toBase: units.lbToKg, fromBase: units.kgToLb },
      {
        id: "oz",
        label: "oz",
        digits: 2,
        toBase: (v) => units.ozToG(v) / 1000,
        fromBase: (b) => units.gToOz(b * 1000),
      },
      { id: "kg", label: "kg", digits: 3, toBase: (v) => v, fromBase: (b) => b },
      { id: "g", label: "g", digits: 1, toBase: (v) => v / 1000, fromBase: (b) => b * 1000 },
    ],
  },
  {
    id: "volume",
    label: "Volume",
    defaultUnit: "gal",
    defaultValue: "5",
    units: [
      {
        id: "gal",
        label: "US gal",
        digits: 2,
        toBase: units.gallonsToLiters,
        fromBase: units.litersToGallons,
      },
      {
        id: "qt",
        label: "US qt",
        digits: 2,
        toBase: units.quartsToLiters,
        fromBase: units.litersToQuarts,
      },
      { id: "l", label: "L", digits: 2, toBase: (v) => v, fromBase: (b) => b },
    ],
  },
  {
    id: "color",
    label: "Color",
    defaultUnit: "srm",
    defaultValue: "10",
    units: [
      { id: "srm", label: "SRM", digits: 1, toBase: (v) => v, fromBase: (b) => b },
      { id: "ebc", label: "EBC", digits: 1, toBase: units.ebcToSrm, fromBase: units.srmToEbc },
      {
        id: "lovibond",
        label: "°L",
        digits: 1,
        toBase: units.lovibondToSrm,
        fromBase: units.srmToLovibond,
      },
    ],
  },
  {
    id: "pressure",
    label: "Pressure",
    defaultUnit: "psi",
    defaultValue: "12",
    units: [
      { id: "psi", label: "PSI", digits: 1, toBase: units.psiToKpa, fromBase: units.kpaToPsi },
      { id: "kpa", label: "kPa", digits: 1, toBase: (v) => v, fromBase: (b) => b },
      { id: "bar", label: "bar", digits: 2, toBase: units.barToKpa, fromBase: units.kpaToBar },
    ],
  },
];

const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c.id, label: c.label }));

export function UnitConverter() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [categoryId, setCategoryId] = useState<CategoryId>("gravity");
  const [fromUnitId, setFromUnitId] = useState("sg");
  const [valueText, setValueText] = useState("1.050");

  const category = CATEGORIES.find((c) => c.id === categoryId) ?? CATEGORIES[0];
  if (!category) return null;

  const fromUnit = category.units.find((u) => u.id === fromUnitId) ?? category.units[0];
  if (!fromUnit) return null;

  const handleCategoryChange = (next: CategoryId) => {
    const nextCategory = CATEGORIES.find((c) => c.id === next);
    if (!nextCategory) return;
    setCategoryId(next);
    setFromUnitId(nextCategory.defaultUnit);
    setValueText(nextCategory.defaultValue);
  };

  const parsed = parseNumber(valueText);
  const baseValue = parsed === null ? null : fromUnit.toBase(parsed);

  const unitOptions = category.units.map((u) => ({
    value: u.id,
    label: u.label,
    accessibilityLabel: `Convert from ${u.label}`,
  }));

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={styles.column}>
        <Text style={styles.sectionTitle}>Brewing Unit Converter</Text>
        <Text style={styles.sectionSubtitle}>
          Convert gravity, temperature, mass, volume, color, and pressure using SI-backed brewing
          conversions.
        </Text>

        <SegmentedControl
          options={CATEGORY_OPTIONS}
          value={categoryId}
          onChange={handleCategoryChange}
          accessibilityLabel="Conversion category"
        />

        <SegmentedControl
          options={unitOptions}
          value={fromUnit.id}
          onChange={setFromUnitId}
          accessibilityLabel="Source unit"
          compact
        />

        <TextField
          label={`Value (${fromUnit.label})`}
          value={valueText}
          onChangeText={setValueText}
          unit={fromUnit.label}
          keyboardType="decimal-pad"
          testID="converter-value-input"
        />
      </Card>

      <Card style={styles.column}>
        <Text style={styles.sectionTitle}>Converted Values</Text>
        {baseValue === null ? (
          <Banner
            tone="error"
            message="Enter a numeric value to convert."
            testID="converter-error"
          />
        ) : (
          <View style={styles.resultsList}>
            {category.units.map((u) => (
              <ResultRow
                key={u.id}
                label={u.label}
                value={formatFixed(u.fromBase(baseValue), u.digits)}
                highlight={u.id === fromUnit.id}
                testID={`converter-result-${u.id}`}
              />
            ))}
          </View>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  layout: {
    gap: spacing.lg,
  },
  layoutDesktop: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  column: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  sectionSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  resultsList: {
    gap: spacing.sm,
  },
});
