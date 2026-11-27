// SPDX-License-Identifier: AGPL-3.0-or-later
import { freeSo2Needed, potassiumMetabisulfite, units } from "@brew-bruvs/brew-math";
import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { DESKTOP_BREAKPOINT, spacing, type ThemeColors } from "../../theme";
import { Banner, Card, ResultRow, SegmentedControl, TextField } from "../ui";
import { FormulaDisclosure, SaveToBatchNote } from "./CalculatorExtras";
import {
  convertText,
  formatFixed,
  formatSmallGrams,
  parseNumber,
  useOnUnitSystemChange,
} from "./parseNumber";

type MolecularPreset = "white" | "red" | "custom";

const PRESET_OPTIONS = [
  {
    value: "white",
    label: "White / Mead / Cider (0.8)",
    accessibilityLabel: "0.8 mg/L molecular SO2 for white wine, mead, and cider",
  },
  {
    value: "red",
    label: "Red Wine (0.5)",
    accessibilityLabel: "0.5 mg/L molecular SO2 for red wine",
  },
  { value: "custom", label: "Custom", accessibilityLabel: "Custom molecular SO2 target" },
] as const;

export function SulfiteCalculator() {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [preset, setPreset] = useState<MolecularPreset>("white");
  const [molecularText, setMolecularText] = useState("0.8");
  const [phText, setPhText] = useState("3.40");
  const [currentFreeText, setCurrentFreeText] = useState("0");
  const [volumeText, setVolumeText] = useState(unitSystem === "us" ? "5.0" : "18.9");

  useOnUnitSystemChange(unitSystem, (next) => {
    setVolumeText((v) =>
      convertText(v, next === "us" ? units.litersToGallons : units.gallonsToLiters, 2),
    );
  });

  const handlePreset = (next: MolecularPreset) => {
    setPreset(next);
    if (next === "white") setMolecularText("0.8");
    if (next === "red") setMolecularText("0.5");
  };

  const volUnit = unitSystem === "us" ? "US gal" : "L";

  const phVal = parseNumber(phText);
  const molVal = parseNumber(molecularText);
  const currentFreeVal = parseNumber(currentFreeText);
  const volVal = parseNumber(volumeText);
  const volumeL =
    volVal === null ? null : unitSystem === "us" ? units.gallonsToLiters(volVal) : volVal;

  const freeResult = phVal !== null && molVal !== null ? freeSo2Needed(phVal, molVal) : null;
  const ppmToAdd =
    freeResult?.ok && currentFreeVal !== null
      ? Math.max(freeResult.value - currentFreeVal, 0)
      : null;
  const kmetaResult =
    ppmToAdd !== null && volumeL !== null ? potassiumMetabisulfite(ppmToAdd, volumeL) : null;

  const errorMessage =
    phVal === null || molVal === null || currentFreeVal === null || volVal === null
      ? "Enter pH, molecular SO₂ target, current free SO₂, and batch volume."
      : currentFreeVal < 0
        ? "Current free SO₂ must be 0 or greater."
        : freeResult && !freeResult.ok
          ? freeResult.error.message
          : kmetaResult && !kmetaResult.ok
            ? kmetaResult.error.message
            : null;

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Sulfite (Free SO₂ & K-Meta)</Text>
        <Text style={styles.sectionSubtitle}>
          Find the free SO₂ target for your pH and the potassium metabisulfite weight required to
          reach it.
        </Text>

        <SegmentedControl
          options={PRESET_OPTIONS}
          value={preset}
          onChange={handlePreset}
          accessibilityLabel="Molecular SO2 target preset"
        />

        <TextField
          label="Target Molecular SO₂"
          value={molecularText}
          onChangeText={(v) => {
            setMolecularText(v);
            setPreset("custom");
          }}
          unit="mg/L"
          keyboardType="decimal-pad"
          testID="sulfite-molecular-input"
        />
        <TextField
          label="Must / Wine pH"
          value={phText}
          onChangeText={setPhText}
          unit="pH"
          keyboardType="decimal-pad"
          helper="Valid range: 2.8–4.2 pH"
          testID="sulfite-ph-input"
        />
        <TextField
          label="Current Free SO₂"
          value={currentFreeText}
          onChangeText={setCurrentFreeText}
          unit="ppm"
          keyboardType="decimal-pad"
          testID="sulfite-current-free-input"
        />
        <TextField
          label="Batch Volume"
          value={volumeText}
          onChangeText={setVolumeText}
          unit={volUnit}
          keyboardType="decimal-pad"
          testID="sulfite-volume-input"
        />
      </Card>

      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Sulfite Dose</Text>
        {errorMessage ? (
          <Banner tone="error" message={errorMessage} testID="sulfite-error" />
        ) : freeResult?.ok && kmetaResult?.ok && ppmToAdd !== null ? (
          <View style={styles.resultsList}>
            <ResultRow
              label="Potassium Metabisulfite"
              value={formatSmallGrams(kmetaResult.value, unitSystem)}
              subtitle={`Raises free SO₂ by ${formatFixed(ppmToAdd, 1)} ppm`}
              highlight
              testID="sulfite-kmeta-result"
            />
            <ResultRow
              label="Target Free SO₂"
              value={`${formatFixed(freeResult.value, 1)} ppm`}
              subtitle={`For ${molecularText} mg/L molecular SO₂ at pH ${phText}`}
              testID="sulfite-free-result"
            />
            <SaveToBatchNote
              calculatorName="Sulfite (SO₂)"
              noteBody={`pH ${phText}, target ${formatFixed(freeResult.value, 1)} ppm free SO₂ (add ${formatFixed(ppmToAdd, 1)} ppm) in ${volumeText} ${volUnit} → ${formatFixed(kmetaResult.value, 2)} g K-Meta`}
            />
          </View>
        ) : null}

        <FormulaDisclosure
          formula="Free SO₂ (mg/L) = Molecular × (1 + 10^(pH − 1.81)) · K-Meta (g) = ppm × L / 576"
          notes="Potassium metabisulfite yields 57.6% SO₂ by weight."
        />
      </Card>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    layout: { gap: spacing.lg },
    layoutDesktop: { flexDirection: "row", alignItems: "flex-start" },
    column: { flex: 1 },
    sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
    sectionSubtitle: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
    resultsList: { gap: spacing.sm },
  });
