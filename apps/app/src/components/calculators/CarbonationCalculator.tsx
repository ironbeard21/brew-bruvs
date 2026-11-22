// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  kegPressure,
  type PrimingSugar,
  primingSugar,
  residualCo2,
  units,
} from "@brew-bruvs/brew-math";
import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useUnits } from "../../state/units";
import { colors, DESKTOP_BREAKPOINT, spacing } from "../../theme";
import { Banner, Card, ResultRow, SegmentedControl, TextField } from "../ui";
import { FormulaDisclosure, SaveToBatchNote } from "./CalculatorExtras";
import {
  convertText,
  formatFixed,
  formatSmallGrams,
  parseNumber,
  useOnUnitSystemChange,
} from "./parseNumber";

type CarbMode = "priming" | "keg";

const MODE_OPTIONS = [
  { value: "priming", label: "Bottle Priming", accessibilityLabel: "Bottle priming sugar" },
  { value: "keg", label: "Keg Pressure", accessibilityLabel: "Keg force carbonation pressure" },
] as const;

const SUGAR_OPTIONS = [
  { value: "corn-sugar", label: "Corn Sugar (Dextrose)" },
  { value: "table-sugar", label: "Table Sugar (Sucrose)" },
] as const;

export interface CarbonationCalculatorProps {
  initialVolumeL?: number | null | undefined;
}

export function CarbonationCalculator({ initialVolumeL }: CarbonationCalculatorProps = {}) {
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [mode, setMode] = useState<CarbMode>("priming");
  const [sugar, setSugar] = useState<PrimingSugar>("corn-sugar");
  const [volumeText, setVolumeText] = useState(() => {
    if (initialVolumeL != null && initialVolumeL > 0) {
      return unitSystem === "us"
        ? units.litersToGallons(initialVolumeL).toFixed(2)
        : initialVolumeL.toFixed(1);
    }
    return unitSystem === "us" ? "5.0" : "18.9";
  });
  const [beerTempText, setBeerTempText] = useState(unitSystem === "us" ? "68" : "20.0");
  const [kegTempText, setKegTempText] = useState(unitSystem === "us" ? "38" : "3.3");
  const [targetVolText, setTargetVolText] = useState("2.4");

  useOnUnitSystemChange(unitSystem, (next) => {
    setVolumeText((v) =>
      convertText(v, next === "us" ? units.litersToGallons : units.gallonsToLiters, 2),
    );
    setBeerTempText((v) => convertText(v, next === "us" ? units.cToF : units.fToC, 1));
    setKegTempText((v) => convertText(v, next === "us" ? units.cToF : units.fToC, 1));
  });

  const volUnit = unitSystem === "us" ? "US gal" : "L";
  const tempUnit = unitSystem === "us" ? "°F" : "°C";

  const volVal = parseNumber(volumeText);
  const beerTempVal = parseNumber(beerTempText);
  const kegTempVal = parseNumber(kegTempText);
  const targetVolVal = parseNumber(targetVolText);

  const volumeL =
    volVal === null ? null : unitSystem === "us" ? units.gallonsToLiters(volVal) : volVal;
  const beerTempC =
    beerTempVal === null ? null : unitSystem === "us" ? units.fToC(beerTempVal) : beerTempVal;
  const kegTempC =
    kegTempVal === null ? null : unitSystem === "us" ? units.fToC(kegTempVal) : kegTempVal;

  const residualResult = beerTempC !== null ? residualCo2(beerTempC) : null;
  const primingResult =
    volumeL !== null && beerTempC !== null && targetVolVal !== null
      ? primingSugar({ volumeL, beerTempC, targetVolumes: targetVolVal, sugar })
      : null;
  const kegResult =
    kegTempC !== null && targetVolVal !== null ? kegPressure(kegTempC, targetVolVal) : null;

  const primingError =
    volVal === null || beerTempVal === null || targetVolVal === null
      ? "Enter batch volume, beer temperature, and target CO₂ volumes."
      : primingResult && !primingResult.ok
        ? primingResult.error.message
        : null;

  const kegError =
    kegTempVal === null || targetVolVal === null
      ? "Enter serving temperature and target CO₂ volumes."
      : kegResult && !kegResult.ok
        ? kegResult.error.message
        : null;

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Carbonation (Priming & Keg PSI)</Text>
        <Text style={styles.sectionSubtitle}>
          Calculate bottle priming sugar accounting for residual CO₂, or set keg regulator pressure
          for force carbonation.
        </Text>

        <SegmentedControl
          options={MODE_OPTIONS}
          value={mode}
          onChange={setMode}
          accessibilityLabel="Carbonation method"
        />

        {mode === "priming" ? (
          <>
            <SegmentedControl
              options={SUGAR_OPTIONS}
              value={sugar}
              onChange={setSugar}
              accessibilityLabel="Priming sugar type"
            />
            <TextField
              label="Batch Volume"
              value={volumeText}
              onChangeText={setVolumeText}
              unit={volUnit}
              keyboardType="decimal-pad"
              testID="carb-volume-input"
            />
            <TextField
              label="Warmest Beer Temperature"
              value={beerTempText}
              onChangeText={setBeerTempText}
              unit={tempUnit}
              keyboardType="decimal-pad"
              helper="Warmest temperature reached after fermentation"
              testID="carb-beer-temp-input"
            />
          </>
        ) : (
          <TextField
            label="Serving / Keezer Temperature"
            value={kegTempText}
            onChangeText={setKegTempText}
            unit={tempUnit}
            keyboardType="decimal-pad"
            testID="carb-keg-temp-input"
          />
        )}

        <TextField
          label="Target Carbonation"
          value={targetVolText}
          onChangeText={setTargetVolText}
          unit="vol CO₂"
          keyboardType="decimal-pad"
          helper="Typical ales: 2.2–2.6 vol · Wheat/Belgian: 3.0–3.5 vol"
          testID="carb-target-vol-input"
        />
      </Card>

      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Results</Text>

        {mode === "priming" ? (
          primingError ? (
            <Banner tone="error" message={primingError} testID="carb-error" />
          ) : primingResult?.ok && residualResult?.ok ? (
            <View style={styles.resultsList}>
              <ResultRow
                label={sugar === "corn-sugar" ? "Corn Sugar Needed" : "Table Sugar Needed"}
                value={formatSmallGrams(primingResult.value, unitSystem)}
                highlight
                testID="carb-priming-result"
              />
              <ResultRow
                label="Residual CO₂"
                value={`${formatFixed(residualResult.value, 2)} vol`}
                subtitle={`Dissolved at ${beerTempText} ${tempUnit}`}
                testID="carb-residual-result"
              />
              <SaveToBatchNote
                calculatorName="Bottle Priming"
                noteBody={`Target ${targetVolText} vol CO₂ in ${volumeText} ${volUnit} at ${beerTempText}${tempUnit} → ${formatSmallGrams(primingResult.value, unitSystem)} ${sugar} (residual ${formatFixed(residualResult.value, 2)} vol)`}
              />
            </View>
          ) : null
        ) : kegError ? (
          <Banner tone="error" message={kegError} testID="carb-error" />
        ) : kegResult?.ok ? (
          <View style={styles.resultsList}>
            <ResultRow
              label="Regulator Pressure"
              value={
                unitSystem === "us"
                  ? `${formatFixed(units.kpaToPsi(kegResult.value), 1)} PSI`
                  : `${formatFixed(units.kpaToBar(kegResult.value), 2)} bar`
              }
              subtitle={
                unitSystem === "us"
                  ? `${formatFixed(kegResult.value, 1)} kPa (${formatFixed(units.kpaToBar(kegResult.value), 2)} bar)`
                  : `${formatFixed(kegResult.value, 1)} kPa (${formatFixed(units.kpaToPsi(kegResult.value), 1)} PSI)`
              }
              highlight
              testID="carb-keg-result"
            />
            <SaveToBatchNote
              calculatorName="Keg Carbonation"
              noteBody={`Target ${targetVolText} vol CO₂ at ${kegTempText}${tempUnit} → ${formatFixed(units.kpaToPsi(kegResult.value), 1)} PSI (${formatFixed(units.kpaToBar(kegResult.value), 2)} bar)`}
            />
          </View>
        ) : null}

        <FormulaDisclosure
          formula={
            mode === "priming"
              ? "Residual CO₂ = 3.0378 − 0.050062·T + 0.00026555·T² (°F) · Sugar (g) = 15.195 × US gal × (V_target − V_res) × factor"
              : "P(psi) = −16.6999 − 0.0101059·T + 0.00116512·T² + 0.173354·T·V + 4.24267·V − 0.0684226·V²"
          }
          notes={
            mode === "priming"
              ? "Corn sugar (dextrose) factor = 1.00; table sugar (sucrose) factor = 0.91."
              : "T in °F, V in CO₂ volumes. Converted to kPa and bar via brew-math/units."
          }
        />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  layout: { gap: spacing.lg },
  layoutDesktop: { flexDirection: "row", alignItems: "flex-start" },
  column: { flex: 1 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  sectionSubtitle: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  resultsList: { gap: spacing.sm },
});
