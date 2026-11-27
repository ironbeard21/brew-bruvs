// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  HONEY_PPG,
  potassiumSorbate,
  SUCROSE_PPG,
  sugarToRaiseGravity,
  units,
} from "@brew-bruvs/brew-math";
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
  formatWeight,
  parseNumber,
  useOnUnitSystemChange,
} from "./parseNumber";

type SweetenerPreset = "honey" | "sugar" | "custom";

const PRESET_OPTIONS = [
  { value: "honey", label: "Honey (35 PPG)", accessibilityLabel: "Backsweeten with honey" },
  { value: "sugar", label: "Sugar (46 PPG)", accessibilityLabel: "Backsweeten with sugar" },
  { value: "custom", label: "Custom", accessibilityLabel: "Custom sweetener PPG" },
] as const;

export function StabilizeBacksweetenCalculator() {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [preset, setPreset] = useState<SweetenerPreset>("honey");
  const [ppgText, setPpgText] = useState(String(HONEY_PPG));
  const [volumeText, setVolumeText] = useState(unitSystem === "us" ? "5.0" : "18.9");
  const [abvText, setAbvText] = useState("12.0");
  const [currentSgText, setCurrentSgText] = useState("1.000");
  const [targetSgText, setTargetSgText] = useState("1.015");

  useOnUnitSystemChange(unitSystem, (next) => {
    setVolumeText((v) =>
      convertText(v, next === "us" ? units.litersToGallons : units.gallonsToLiters, 2),
    );
  });

  const handlePreset = (next: SweetenerPreset) => {
    setPreset(next);
    if (next === "honey") setPpgText(String(HONEY_PPG));
    if (next === "sugar") setPpgText(String(SUCROSE_PPG));
  };

  const volUnit = unitSystem === "us" ? "US gal" : "L";

  const volVal = parseNumber(volumeText);
  const abvVal = parseNumber(abvText);
  const currentSg = parseNumber(currentSgText);
  const targetSg = parseNumber(targetSgText);
  const ppgVal = parseNumber(ppgText);

  const volumeL =
    volVal === null ? null : unitSystem === "us" ? units.gallonsToLiters(volVal) : volVal;

  const sorbateResult =
    abvVal !== null && volumeL !== null ? potassiumSorbate(abvVal, volumeL) : null;
  const sweetenerResult =
    volumeL !== null && currentSg !== null && targetSg !== null && ppgVal !== null
      ? sugarToRaiseGravity({
          volumeL,
          currentSg,
          targetSg,
          pointsPerPoundPerGallon: ppgVal,
        })
      : null;

  const errorMessage =
    volVal === null || abvVal === null || currentSg === null || targetSg === null || ppgVal === null
      ? "Enter volume, ABV, current gravity, target gravity, and sweetener potential."
      : sorbateResult && !sorbateResult.ok
        ? sorbateResult.error.message
        : sweetenerResult && !sweetenerResult.ok
          ? sweetenerResult.error.message
          : null;

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Stabilize & Backsweeten</Text>
        <Text style={styles.sectionSubtitle}>
          Calculate potassium sorbate to stabilize a finished mead, wine, or cider and the sweetener
          needed to reach your target sweetness.
        </Text>

        <TextField
          label="Batch Volume"
          value={volumeText}
          onChangeText={setVolumeText}
          unit={volUnit}
          keyboardType="decimal-pad"
          testID="stabilize-volume-input"
        />
        <TextField
          label="Finished ABV"
          value={abvText}
          onChangeText={setAbvText}
          unit="%"
          keyboardType="decimal-pad"
          helper="Valid range: 4–15% ABV"
          testID="stabilize-abv-input"
        />

        <SegmentedControl
          options={PRESET_OPTIONS}
          value={preset}
          onChange={handlePreset}
          accessibilityLabel="Backsweetener preset"
        />

        <TextField
          label="Sweetener Potential"
          value={ppgText}
          onChangeText={(v) => {
            setPpgText(v);
            setPreset("custom");
          }}
          unit="PPG"
          keyboardType="decimal-pad"
          testID="stabilize-ppg-input"
        />
        <TextField
          label="Current Final Gravity"
          value={currentSgText}
          onChangeText={setCurrentSgText}
          unit="SG"
          keyboardType="decimal-pad"
          testID="stabilize-current-sg-input"
        />
        <TextField
          label="Target Sweetness Gravity"
          value={targetSgText}
          onChangeText={setTargetSgText}
          unit="SG"
          keyboardType="decimal-pad"
          testID="stabilize-target-sg-input"
        />
      </Card>

      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Stabilizing & Backsweetening Plan</Text>
        {errorMessage ? (
          <Banner tone="error" message={errorMessage} testID="stabilize-error" />
        ) : sorbateResult?.ok && sweetenerResult?.ok ? (
          <View style={styles.resultsList}>
            <ResultRow
              label="Potassium Sorbate"
              value={formatSmallGrams(sorbateResult.value.grams, unitSystem)}
              subtitle={`Target ${Math.round(sorbateResult.value.sorbicAcidMgL)} mg/L sorbic acid at ${abvText}% ABV`}
              highlight
              testID="stabilize-sorbate-result"
            />
            <ResultRow
              label="Sweetener to Add"
              value={formatWeight(sweetenerResult.value, unitSystem)}
              subtitle={`Raises ${currentSgText} → ${targetSgText} SG`}
              testID="stabilize-sweetener-result"
            />
            <Banner
              tone="info"
              message="Always pair potassium sorbate with sulfite (K-Meta) — sorbate alone does not inhibit malolactic bacteria."
              testID="stabilize-sulfite-reminder"
            />
            <SaveToBatchNote
              calculatorName="Stabilize & Backsweeten"
              noteBody={`${volumeText} ${volUnit} at ${abvText}% ABV → ${formatFixed(sorbateResult.value.grams, 2)} g K-Sorbate (${Math.round(sorbateResult.value.sorbicAcidMgL)} mg/L sorbic acid) + ${formatWeight(sweetenerResult.value, unitSystem)} sweetener (${currentSgText} → ${targetSgText} SG)`}
            />
          </View>
        ) : null}

        <FormulaDisclosure
          formula="Sorbic acid (mg/L) = 150 − 25 × (ABV − 10) · K-Sorbate (g) = mg/L × L / 1000 / (112.13 / 150.22)"
          notes="Sweetener weight uses lb = (SG_target − SG_current) × 1000 × US gal / PPG. Always pair sorbate with sulfite."
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
