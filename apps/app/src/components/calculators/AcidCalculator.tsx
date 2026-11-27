// SPDX-License-Identifier: AGPL-3.0-or-later
import { type Acid, acidAddition, units } from "@brew-bruvs/brew-math";
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

const ACID_OPTIONS = [
  { value: "tartaric", label: "Tartaric", accessibilityLabel: "Tartaric acid" },
  { value: "malic", label: "Malic", accessibilityLabel: "Malic acid" },
  { value: "citric", label: "Citric", accessibilityLabel: "Citric acid" },
] as const;

export function AcidCalculator() {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [acid, setAcid] = useState<Acid>("tartaric");
  const [volumeText, setVolumeText] = useState(unitSystem === "us" ? "5.0" : "18.9");
  const [currentTaText, setCurrentTaText] = useState("4.5");
  const [targetTaText, setTargetTaText] = useState("6.5");

  useOnUnitSystemChange(unitSystem, (next) => {
    setVolumeText((v) =>
      convertText(v, next === "us" ? units.litersToGallons : units.gallonsToLiters, 2),
    );
  });

  const volUnit = unitSystem === "us" ? "US gal" : "L";

  const volVal = parseNumber(volumeText);
  const currentTa = parseNumber(currentTaText);
  const targetTa = parseNumber(targetTaText);
  const volumeL =
    volVal === null ? null : unitSystem === "us" ? units.gallonsToLiters(volVal) : volVal;

  const result =
    volumeL !== null && currentTa !== null && targetTa !== null
      ? acidAddition({ volumeL, currentTa, targetTa, acid })
      : null;

  const errorMessage =
    volVal === null || currentTa === null || targetTa === null
      ? "Enter batch volume, current TA, and target TA."
      : result && !result.ok
        ? result.error.message
        : null;

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Acid Adjustment (TA)</Text>
        <Text style={styles.sectionSubtitle}>
          Calculate grams of tartaric, malic, or citric acid to raise titratable acidity (expressed
          as tartaric, g/L).
        </Text>

        <SegmentedControl
          options={ACID_OPTIONS}
          value={acid}
          onChange={setAcid}
          accessibilityLabel="Acid type"
        />

        <TextField
          label="Batch Volume"
          value={volumeText}
          onChangeText={setVolumeText}
          unit={volUnit}
          keyboardType="decimal-pad"
          testID="acid-volume-input"
        />
        <TextField
          label="Current Titratable Acidity"
          value={currentTaText}
          onChangeText={setCurrentTaText}
          unit="g/L"
          keyboardType="decimal-pad"
          testID="acid-current-ta-input"
        />
        <TextField
          label="Target Titratable Acidity"
          value={targetTaText}
          onChangeText={setTargetTaText}
          unit="g/L"
          keyboardType="decimal-pad"
          helper="Typical wine/mead/cider range: 5.5–8.0 g/L"
          testID="acid-target-ta-input"
        />
      </Card>

      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Acid Addition</Text>
        {errorMessage ? (
          <Banner tone="error" message={errorMessage} testID="acid-error" />
        ) : result?.ok ? (
          <View style={styles.resultsList}>
            <ResultRow
              label={`${acid.charAt(0).toUpperCase() + acid.slice(1)} Acid Needed`}
              value={formatSmallGrams(result.value, unitSystem)}
              subtitle={`Raises TA by ${formatFixed((targetTa ?? 0) - (currentTa ?? 0), 2)} g/L`}
              highlight
              testID="acid-grams-result"
            />
            <SaveToBatchNote
              calculatorName="Acid Adjustment"
              noteBody={`${volumeText} ${volUnit}, TA ${currentTaText} → ${targetTaText} g/L → add ${formatFixed(result.value, 1)} g ${acid} acid`}
            />
          </View>
        ) : null}

        <FormulaDisclosure
          formula="Acid (g) = (TA_target − TA_current) × L × equivalent_factor"
          notes="Equivalent weight factors relative to tartaric acid: tartaric = 1.000, malic = 67.05 / 75.04 (0.8935), citric = 64.04 / 75.04 (0.8534)."
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
