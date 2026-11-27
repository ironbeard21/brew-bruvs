// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  GRAIN_ABSORPTION_L_PER_KG,
  spargeVolume,
  strikeTemperature,
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
  formatTemp,
  formatVolume,
  galPerLbToLPerKg,
  lPerKgToGalPerLb,
  lPerKgToQtPerLb,
  parseNumber,
  qtPerLbToLPerKg,
  useOnUnitSystemChange,
} from "./parseNumber";

type WaterMode = "strike" | "sparge";

const MODE_OPTIONS = [
  { value: "strike", label: "Strike Water", accessibilityLabel: "Strike water temperature" },
  { value: "sparge", label: "Sparge Water", accessibilityLabel: "Sparge water volume" },
] as const;

export function StrikeSpargeCalculator() {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [mode, setMode] = useState<WaterMode>("strike");

  // Strike inputs
  const [ratioText, setRatioText] = useState(unitSystem === "us" ? "1.5" : "3.1");
  const [grainTempText, setGrainTempText] = useState(unitSystem === "us" ? "68" : "20.0");
  const [targetTempText, setTargetTempText] = useState(unitSystem === "us" ? "152" : "66.7");

  // Sparge inputs
  const [preBoilText, setPreBoilText] = useState(unitSystem === "us" ? "6.5" : "24.6");
  const [mashWaterText, setMashWaterText] = useState(unitSystem === "us" ? "4.0" : "15.1");
  const [grainWeightText, setGrainWeightText] = useState(unitSystem === "us" ? "10" : "4.54");
  const [absorptionText, setAbsorptionText] = useState(
    unitSystem === "us" ? "0.125" : formatFixed(GRAIN_ABSORPTION_L_PER_KG, 2),
  );
  const [deadspaceText, setDeadspaceText] = useState("0");

  useOnUnitSystemChange(unitSystem, (next) => {
    setRatioText((v) => convertText(v, next === "us" ? lPerKgToQtPerLb : qtPerLbToLPerKg, 2));
    setGrainTempText((v) => convertText(v, next === "us" ? units.cToF : units.fToC, 1));
    setTargetTempText((v) => convertText(v, next === "us" ? units.cToF : units.fToC, 1));
    setPreBoilText((v) =>
      convertText(v, next === "us" ? units.litersToGallons : units.gallonsToLiters, 2),
    );
    setMashWaterText((v) =>
      convertText(v, next === "us" ? units.litersToGallons : units.gallonsToLiters, 2),
    );
    setGrainWeightText((v) => convertText(v, next === "us" ? units.kgToLb : units.lbToKg, 2));
    setAbsorptionText((v) =>
      convertText(v, next === "us" ? lPerKgToGalPerLb : galPerLbToLPerKg, 3),
    );
    setDeadspaceText((v) =>
      convertText(v, next === "us" ? units.litersToGallons : units.gallonsToLiters, 2),
    );
  });

  const tempUnit = unitSystem === "us" ? "°F" : "°C";
  const volUnit = unitSystem === "us" ? "US gal" : "L";
  const massUnit = unitSystem === "us" ? "lb" : "kg";
  const ratioUnit = unitSystem === "us" ? "qt/lb" : "L/kg";
  const absorptionUnit = unitSystem === "us" ? "gal/lb" : "L/kg";

  // Strike calculation
  const ratioVal = parseNumber(ratioText);
  const grainTempVal = parseNumber(grainTempText);
  const targetTempVal = parseNumber(targetTempText);
  const ratioLPerKg =
    ratioVal === null ? null : unitSystem === "us" ? qtPerLbToLPerKg(ratioVal) : ratioVal;
  const grainTempC =
    grainTempVal === null ? null : unitSystem === "us" ? units.fToC(grainTempVal) : grainTempVal;
  const targetTempC =
    targetTempVal === null ? null : unitSystem === "us" ? units.fToC(targetTempVal) : targetTempVal;

  const strikeResult =
    ratioLPerKg !== null && grainTempC !== null && targetTempC !== null
      ? strikeTemperature(ratioLPerKg, grainTempC, targetTempC)
      : null;

  // Sparge calculation
  const preBoilVal = parseNumber(preBoilText);
  const mashWaterVal = parseNumber(mashWaterText);
  const grainWeightVal = parseNumber(grainWeightText);
  const absorptionVal = parseNumber(absorptionText);
  const deadspaceVal = parseNumber(deadspaceText);

  const preBoilL =
    preBoilVal === null
      ? null
      : unitSystem === "us"
        ? units.gallonsToLiters(preBoilVal)
        : preBoilVal;
  const mashWaterL =
    mashWaterVal === null
      ? null
      : unitSystem === "us"
        ? units.gallonsToLiters(mashWaterVal)
        : mashWaterVal;
  const grainKg =
    grainWeightVal === null
      ? null
      : unitSystem === "us"
        ? units.lbToKg(grainWeightVal)
        : grainWeightVal;
  const absorptionLPerKg =
    absorptionVal === null
      ? null
      : unitSystem === "us"
        ? galPerLbToLPerKg(absorptionVal)
        : absorptionVal;
  const deadspaceL =
    deadspaceVal === null
      ? null
      : unitSystem === "us"
        ? units.gallonsToLiters(deadspaceVal)
        : deadspaceVal;

  const spargeResult =
    preBoilL !== null &&
    mashWaterL !== null &&
    grainKg !== null &&
    absorptionLPerKg !== null &&
    deadspaceL !== null
      ? spargeVolume({
          preBoilVolumeL: preBoilL,
          mashWaterL,
          grainKg,
          grainAbsorptionLPerKg: absorptionLPerKg,
          mashTunDeadspaceL: deadspaceL,
        })
      : null;

  const strikeError =
    ratioVal === null || grainTempVal === null || targetTempVal === null
      ? "Enter water-to-grain ratio, grain temperature, and target mash temperature."
      : strikeResult && !strikeResult.ok
        ? strikeResult.error.message
        : null;

  const spargeError =
    preBoilVal === null ||
    mashWaterVal === null ||
    grainWeightVal === null ||
    absorptionVal === null ||
    deadspaceVal === null
      ? "Enter all volume, grain weight, absorption, and deadspace fields."
      : spargeResult && !spargeResult.ok
        ? spargeResult.error.message
        : null;

  const estimatedRunoffL =
    mashWaterL !== null && grainKg !== null && absorptionLPerKg !== null && deadspaceL !== null
      ? Math.max(mashWaterL - grainKg * absorptionLPerKg - deadspaceL, 0)
      : null;

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Strike & Sparge Water</Text>
        <Text style={styles.sectionSubtitle}>
          Calculate strike water temperature for dough-in and sparge water needed to hit pre-boil
          volume.
        </Text>

        <SegmentedControl
          options={MODE_OPTIONS}
          value={mode}
          onChange={setMode}
          accessibilityLabel="Water calculation mode"
        />

        {mode === "strike" ? (
          <>
            <TextField
              label="Water-to-Grain Ratio"
              value={ratioText}
              onChangeText={setRatioText}
              unit={ratioUnit}
              keyboardType="decimal-pad"
              testID="strike-ratio-input"
            />
            <TextField
              label="Grain Temperature"
              value={grainTempText}
              onChangeText={setGrainTempText}
              unit={tempUnit}
              keyboardType="decimal-pad"
              testID="strike-grain-temp-input"
            />
            <TextField
              label="Target Mash Temperature"
              value={targetTempText}
              onChangeText={setTargetTempText}
              unit={tempUnit}
              keyboardType="decimal-pad"
              testID="strike-target-temp-input"
            />
          </>
        ) : (
          <>
            <TextField
              label="Pre-Boil Volume"
              value={preBoilText}
              onChangeText={setPreBoilText}
              unit={volUnit}
              keyboardType="decimal-pad"
              testID="sparge-preboil-input"
            />
            <TextField
              label="Mash Water Volume"
              value={mashWaterText}
              onChangeText={setMashWaterText}
              unit={volUnit}
              keyboardType="decimal-pad"
              testID="sparge-mash-water-input"
            />
            <TextField
              label="Grain Weight"
              value={grainWeightText}
              onChangeText={setGrainWeightText}
              unit={massUnit}
              keyboardType="decimal-pad"
              testID="sparge-grain-input"
            />
            <TextField
              label="Grain Absorption"
              value={absorptionText}
              onChangeText={setAbsorptionText}
              unit={absorptionUnit}
              keyboardType="decimal-pad"
              helper={
                unitSystem === "us" ? "Palmer default: 0.125 gal/lb" : "Palmer default: 1.04 L/kg"
              }
              testID="sparge-absorption-input"
            />
            <TextField
              label="Mash Tun Deadspace"
              value={deadspaceText}
              onChangeText={setDeadspaceText}
              unit={volUnit}
              keyboardType="decimal-pad"
              testID="sparge-deadspace-input"
            />
          </>
        )}
      </Card>

      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Results</Text>

        {mode === "strike" ? (
          strikeError ? (
            <Banner tone="error" message={strikeError} testID="strike-error" />
          ) : strikeResult?.ok ? (
            <View style={styles.resultsList}>
              <ResultRow
                label="Strike Water Temperature"
                value={formatTemp(strikeResult.value, unitSystem)}
                subtitle={
                  unitSystem === "us"
                    ? `${formatFixed(strikeResult.value, 1)} °C`
                    : `${formatFixed(units.cToF(strikeResult.value), 1)} °F`
                }
                highlight
                testID="strike-temp-result"
              />
              <SaveToBatchNote
                calculatorName="Strike Water"
                noteBody={`Ratio ${ratioText} ${ratioUnit}, grain ${grainTempText}${tempUnit}, target ${targetTempText}${tempUnit} → strike at ${formatTemp(strikeResult.value, unitSystem)}`}
              />
            </View>
          ) : null
        ) : spargeError ? (
          <Banner tone="error" message={spargeError} testID="sparge-error" />
        ) : spargeResult?.ok ? (
          <View style={styles.resultsList}>
            <ResultRow
              label="Sparge Water Needed"
              value={formatVolume(spargeResult.value, unitSystem)}
              subtitle={
                spargeResult.value === 0
                  ? "Mash water alone reaches pre-boil volume"
                  : unitSystem === "us"
                    ? `${formatFixed(spargeResult.value, 2)} L`
                    : `${formatFixed(units.litersToGallons(spargeResult.value), 2)} US gal`
              }
              highlight
              testID="sparge-volume-result"
            />
            {estimatedRunoffL !== null ? (
              <ResultRow
                label="First Runnings Estimate"
                value={formatVolume(estimatedRunoffL, unitSystem)}
                subtitle="After grain absorption and deadspace"
                testID="sparge-runoff-result"
              />
            ) : null}
            <SaveToBatchNote
              calculatorName="Sparge Water"
              noteBody={`Pre-boil ${preBoilText} ${volUnit}, mash ${mashWaterText} ${volUnit}, grain ${grainWeightText} ${massUnit} → sparge ${formatVolume(spargeResult.value, unitSystem)}`}
            />
          </View>
        ) : null}

        <FormulaDisclosure
          formula={
            mode === "strike"
              ? "Tw = (0.41 / r) × (T2 − T1) + T2 (r in L/kg, T in °C)"
              : "Sparge = max(Pre-boil − (Mash Water − Grain × Absorption − Deadspace), 0)"
          }
          notes={
            mode === "strike"
              ? "John Palmer, How to Brew (metric form with 0.41 thermodynamic constant for L/kg)."
              : "Default grain absorption is Palmer's 0.125 US gal/lb (≈ 1.04 L/kg)."
          }
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
