// SPDX-License-Identifier: AGPL-3.0-or-later
import { infusionVolume, units } from "@brew-bruvs/brew-math";
import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { DESKTOP_BREAKPOINT, spacing, type ThemeColors } from "../../theme";
import { Banner, Card, ResultRow, TextField } from "../ui";
import { FormulaDisclosure, SaveToBatchNote } from "./CalculatorExtras";
import {
  convertText,
  formatFixed,
  formatVolume,
  parseNumber,
  useOnUnitSystemChange,
} from "./parseNumber";

export function InfusionCalculator() {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [currentTempText, setCurrentTempText] = useState(unitSystem === "us" ? "148" : "64.4");
  const [targetTempText, setTargetTempText] = useState(unitSystem === "us" ? "156" : "68.9");
  const [grainText, setGrainText] = useState(unitSystem === "us" ? "10" : "4.54");
  const [mashWaterText, setMashWaterText] = useState(unitSystem === "us" ? "3.75" : "14.2");
  const [infusionTempText, setInfusionTempText] = useState(unitSystem === "us" ? "212" : "100.0");

  useOnUnitSystemChange(unitSystem, (next) => {
    setCurrentTempText((v) => convertText(v, next === "us" ? units.cToF : units.fToC, 1));
    setTargetTempText((v) => convertText(v, next === "us" ? units.cToF : units.fToC, 1));
    setGrainText((v) => convertText(v, next === "us" ? units.kgToLb : units.lbToKg, 2));
    setMashWaterText((v) =>
      convertText(v, next === "us" ? units.litersToGallons : units.gallonsToLiters, 2),
    );
    setInfusionTempText((v) => convertText(v, next === "us" ? units.cToF : units.fToC, 1));
  });

  const tempUnit = unitSystem === "us" ? "°F" : "°C";
  const volUnit = unitSystem === "us" ? "US gal" : "L";
  const massUnit = unitSystem === "us" ? "lb" : "kg";

  const curVal = parseNumber(currentTempText);
  const tgtVal = parseNumber(targetTempText);
  const grainVal = parseNumber(grainText);
  const waterVal = parseNumber(mashWaterText);
  const infVal = parseNumber(infusionTempText);

  const result =
    curVal !== null && tgtVal !== null && grainVal !== null && waterVal !== null && infVal !== null
      ? infusionVolume({
          currentTempC: unitSystem === "us" ? units.fToC(curVal) : curVal,
          targetTempC: unitSystem === "us" ? units.fToC(tgtVal) : tgtVal,
          grainKg: unitSystem === "us" ? units.lbToKg(grainVal) : grainVal,
          waterInMashL: unitSystem === "us" ? units.gallonsToLiters(waterVal) : waterVal,
          infusionTempC: unitSystem === "us" ? units.fToC(infVal) : infVal,
        })
      : null;

  const errorMessage =
    curVal === null || tgtVal === null || grainVal === null || waterVal === null || infVal === null
      ? "Enter all temperatures, grain weight, and current mash water volume."
      : result && !result.ok
        ? result.error.message
        : null;

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Step Infusion Volume</Text>
        <Text style={styles.sectionSubtitle}>
          Calculate how much hot water to add to step a mash up to a higher rest temperature.
        </Text>

        <TextField
          label="Current Mash Temperature"
          value={currentTempText}
          onChangeText={setCurrentTempText}
          unit={tempUnit}
          keyboardType="decimal-pad"
          testID="infusion-current-temp-input"
        />
        <TextField
          label="Target Mash Temperature"
          value={targetTempText}
          onChangeText={setTargetTempText}
          unit={tempUnit}
          keyboardType="decimal-pad"
          testID="infusion-target-temp-input"
        />
        <TextField
          label="Grain Weight"
          value={grainText}
          onChangeText={setGrainText}
          unit={massUnit}
          keyboardType="decimal-pad"
          testID="infusion-grain-input"
        />
        <TextField
          label="Water Already in Mash"
          value={mashWaterText}
          onChangeText={setMashWaterText}
          unit={volUnit}
          keyboardType="decimal-pad"
          testID="infusion-mash-water-input"
        />
        <TextField
          label="Infusion Water Temperature"
          value={infusionTempText}
          onChangeText={setInfusionTempText}
          unit={tempUnit}
          keyboardType="decimal-pad"
          helper={unitSystem === "us" ? "Boiling is 212 °F" : "Boiling is 100 °C"}
          testID="infusion-water-temp-input"
        />
      </Card>

      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Water to Add</Text>
        {errorMessage ? (
          <Banner tone="error" message={errorMessage} testID="infusion-error" />
        ) : result?.ok ? (
          <View style={styles.resultsList}>
            <ResultRow
              label="Infusion Water Needed"
              value={formatVolume(result.value, unitSystem)}
              subtitle={
                unitSystem === "us"
                  ? `${formatFixed(units.litersToQuarts(result.value), 2)} US qt (${formatFixed(result.value, 2)} L)`
                  : `${formatFixed(units.litersToGallons(result.value), 2)} US gal`
              }
              highlight
              testID="infusion-volume-result"
            />
            <SaveToBatchNote
              calculatorName="Step Infusion"
              noteBody={`Raise mash from ${currentTempText}${tempUnit} to ${targetTempText}${tempUnit} → add ${formatVolume(result.value, unitSystem)} at ${infusionTempText}${tempUnit}`}
            />
          </View>
        ) : null}

        <FormulaDisclosure
          formula="Wa = (T2 − T1) × (0.41 × G + Wm) / (Tw − T2)"
          notes="John Palmer, How to Brew. G = grain weight (kg), Wm = water already in mash (L), temperatures in °C."
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
