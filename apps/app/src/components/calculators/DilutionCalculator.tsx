// SPDX-License-Identifier: AGPL-3.0-or-later
import { gravityAdjustment, units } from "@brew-bruvs/brew-math";
import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { DESKTOP_BREAKPOINT, spacing, type ThemeColors } from "../../theme";
import { Banner, Card, ResultRow, TextField } from "../ui";
import { FormulaDisclosure, SaveToBatchNote } from "./CalculatorExtras";
import { convertText, formatVolume, parseNumber, useOnUnitSystemChange } from "./parseNumber";

export function DilutionCalculator() {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [volumeText, setVolumeText] = useState(unitSystem === "us" ? "5.0" : "18.9");
  const [currentSgText, setCurrentSgText] = useState("1.065");
  const [targetSgText, setTargetSgText] = useState("1.055");

  useOnUnitSystemChange(unitSystem, (next) => {
    setVolumeText((v) =>
      convertText(v, next === "us" ? units.litersToGallons : units.gallonsToLiters, 2),
    );
  });

  const volUnit = unitSystem === "us" ? "US gal" : "L";

  const volVal = parseNumber(volumeText);
  const currentSg = parseNumber(currentSgText);
  const targetSg = parseNumber(targetSgText);
  const volumeL =
    volVal === null ? null : unitSystem === "us" ? units.gallonsToLiters(volVal) : volVal;

  const result =
    volumeL !== null && currentSg !== null && targetSg !== null
      ? gravityAdjustment(volumeL, currentSg, targetSg)
      : null;

  const errorMessage =
    volVal === null || currentSg === null || targetSg === null
      ? "Enter current volume, current gravity, and target gravity."
      : result && !result.ok
        ? result.error.message
        : null;

  const changeAction =
    result?.ok && result.value.changeL > 0
      ? `Add ${formatVolume(result.value.changeL, unitSystem)} water`
      : result?.ok && result.value.changeL < 0
        ? `Boil off ${formatVolume(Math.abs(result.value.changeL), unitSystem)}`
        : "No volume change needed";

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Dilution & Boil-Off</Text>
        <Text style={styles.sectionSubtitle}>
          Find how much water to add (dilute) or boil off (concentrate) to hit your target gravity.
        </Text>

        <TextField
          label="Current Volume"
          value={volumeText}
          onChangeText={setVolumeText}
          unit={volUnit}
          keyboardType="decimal-pad"
          testID="dilution-volume-input"
        />
        <TextField
          label="Current Gravity"
          value={currentSgText}
          onChangeText={setCurrentSgText}
          unit="SG"
          keyboardType="decimal-pad"
          testID="dilution-current-sg-input"
        />
        <TextField
          label="Target Gravity"
          value={targetSgText}
          onChangeText={setTargetSgText}
          unit="SG"
          keyboardType="decimal-pad"
          testID="dilution-target-sg-input"
        />
      </Card>

      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Volume Adjustment</Text>
        {errorMessage ? (
          <Banner tone="error" message={errorMessage} testID="dilution-error" />
        ) : result?.ok ? (
          <View style={styles.resultsList}>
            <ResultRow
              label={result.value.changeL >= 0 ? "Water to Add" : "Volume to Boil Off"}
              value={formatVolume(Math.abs(result.value.changeL), unitSystem)}
              subtitle={changeAction}
              highlight
              testID="dilution-change-result"
            />
            <ResultRow
              label="Final Volume"
              value={formatVolume(result.value.finalVolumeL, unitSystem)}
              testID="dilution-final-volume-result"
            />
            <SaveToBatchNote
              calculatorName="Dilution & Boil-Off"
              noteBody={`${volumeText} ${volUnit} at ${currentSgText} SG → target ${targetSgText} SG: ${changeAction} (final ${formatVolume(result.value.finalVolumeL, unitSystem)})`}
            />
          </View>
        ) : null}

        <FormulaDisclosure
          formula="V2 = V1 × (SG1 − 1) / (SG2 − 1) · ΔV = V2 − V1"
          notes="Conserves total gravity points. Positive ΔV is dilution water to add; negative ΔV is boil-off volume."
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
