// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  type NitrogenNeed,
  NUTRIENT_NITROGEN_FRACTION,
  nutrientPlan,
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

type NutrientPreset = "dap" | "fermaid-k" | "custom";

const NEED_OPTIONS = [
  { value: "low", label: "Low (0.75)", accessibilityLabel: "Low yeast nitrogen need" },
  { value: "medium", label: "Medium (0.90)", accessibilityLabel: "Medium yeast nitrogen need" },
  { value: "high", label: "High (1.25)", accessibilityLabel: "High yeast nitrogen need" },
] as const;

const NUTRIENT_OPTIONS = [
  { value: "dap", label: "DAP (21% N)", accessibilityLabel: "DAP at 21 percent nitrogen" },
  {
    value: "fermaid-k",
    label: "Fermaid-K (13% N)",
    accessibilityLabel: "Fermaid-K at 13 percent nitrogen",
  },
  { value: "custom", label: "Custom", accessibilityLabel: "Custom nitrogen percentage" },
] as const;

export function NutrientsCalculator() {
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [need, setNeed] = useState<NitrogenNeed>("medium");
  const [nutrient, setNutrient] = useState<NutrientPreset>("dap");
  const [nitrogenPctText, setNitrogenPctText] = useState(
    String(NUTRIENT_NITROGEN_FRACTION.dap * 100),
  );
  const [volumeText, setVolumeText] = useState(unitSystem === "us" ? "5.0" : "18.9");
  const [ogText, setOgText] = useState("1.100");
  const [expectedFgText, setExpectedFgText] = useState("1.000");
  const [measuredYanText, setMeasuredYanText] = useState("0");

  useOnUnitSystemChange(unitSystem, (next) => {
    setVolumeText((v) =>
      convertText(v, next === "us" ? units.litersToGallons : units.gallonsToLiters, 2),
    );
  });

  const handleNutrient = (next: NutrientPreset) => {
    setNutrient(next);
    if (next === "dap") setNitrogenPctText(String(NUTRIENT_NITROGEN_FRACTION.dap * 100));
    if (next === "fermaid-k") {
      setNitrogenPctText(String(NUTRIENT_NITROGEN_FRACTION["fermaid-k"] * 100));
    }
  };

  const volUnit = unitSystem === "us" ? "US gal" : "L";

  const volVal = parseNumber(volumeText);
  const ogVal = parseNumber(ogText);
  const fgVal = parseNumber(expectedFgText);
  const yanVal = parseNumber(measuredYanText);
  const nPctVal = parseNumber(nitrogenPctText);

  const volumeL =
    volVal === null ? null : unitSystem === "us" ? units.gallonsToLiters(volVal) : volVal;

  const result =
    volumeL !== null && ogVal !== null && fgVal !== null && yanVal !== null && nPctVal !== null
      ? nutrientPlan({
          volumeL,
          og: ogVal,
          expectedFg: fgVal,
          need,
          measuredYan: yanVal,
          nitrogenFraction: nPctVal / 100,
        })
      : null;

  const errorMessage =
    volVal === null || ogVal === null || fgVal === null || yanVal === null || nPctVal === null
      ? "Enter volume, OG, expected FG, measured YAN, and nutrient nitrogen %."
      : result && !result.ok
        ? result.error.message
        : null;

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Staggered Yeast Nutrients (YAN)</Text>
        <Text style={styles.sectionSubtitle}>
          Calculate target YAN and a staggered nutrient schedule split between 24 h post-pitch and
          the 1/3 sugar break.
        </Text>

        <SegmentedControl
          options={NEED_OPTIONS}
          value={need}
          onChange={setNeed}
          accessibilityLabel="Yeast nitrogen need"
        />

        <SegmentedControl
          options={NUTRIENT_OPTIONS}
          value={nutrient}
          onChange={handleNutrient}
          accessibilityLabel="Nutrient source"
        />

        <TextField
          label="Nutrient Nitrogen Content"
          value={nitrogenPctText}
          onChangeText={(v) => {
            setNitrogenPctText(v);
            setNutrient("custom");
          }}
          unit="% N"
          keyboardType="decimal-pad"
          testID="nutrients-n-pct-input"
        />
        <TextField
          label="Must Volume"
          value={volumeText}
          onChangeText={setVolumeText}
          unit={volUnit}
          keyboardType="decimal-pad"
          testID="nutrients-volume-input"
        />
        <TextField
          label="Original Gravity"
          value={ogText}
          onChangeText={setOgText}
          unit="SG"
          keyboardType="decimal-pad"
          testID="nutrients-og-input"
        />
        <TextField
          label="Expected Final Gravity"
          value={expectedFgText}
          onChangeText={setExpectedFgText}
          unit="SG"
          keyboardType="decimal-pad"
          testID="nutrients-fg-input"
        />
        <TextField
          label="Measured Must YAN"
          value={measuredYanText}
          onChangeText={setMeasuredYanText}
          unit="mg/L"
          keyboardType="decimal-pad"
          helper="Honey musts are close to 0 mg/L"
          testID="nutrients-yan-input"
        />
      </Card>

      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Nutrient Schedule</Text>
        {errorMessage ? (
          <Banner tone="error" message={errorMessage} testID="nutrients-error" />
        ) : result?.ok ? (
          <View style={styles.resultsList}>
            <ResultRow
              label="Total Nutrient Needed"
              value={formatSmallGrams(result.value.totalGrams, unitSystem)}
              subtitle={`YAN target ${Math.round(result.value.yanTarget)} mg/L (shortfall ${Math.round(result.value.shortfall)} mg/L)`}
              highlight
              testID="nutrients-total-result"
            />
            <ResultRow
              label="Dose 1 — 12–24h After Pitch"
              value={formatSmallGrams(result.value.doses[0]?.grams ?? 0, unitSystem)}
              testID="nutrients-dose-1"
            />
            <ResultRow
              label="Dose 2 — 1/3 Sugar Break"
              value={formatSmallGrams(result.value.doses[1]?.grams ?? 0, unitSystem)}
              subtitle={`At ~${formatFixed(result.value.oneThirdBreakSg, 3)} SG`}
              testID="nutrients-dose-2"
            />
            <SaveToBatchNote
              calculatorName="Yeast Nutrients"
              noteBody={`YAN target ${Math.round(result.value.yanTarget)} mg/L (${need}) → ${formatFixed(result.value.totalGrams, 1)} g total (${formatFixed(result.value.doses[0]?.grams ?? 0, 1)} g at 24h, ${formatFixed(result.value.doses[1]?.grams ?? 0, 1)} g at ${formatFixed(result.value.oneThirdBreakSg, 3)} SG)`}
            />
          </View>
        ) : null}

        <FormulaDisclosure
          formula="YAN_target = Brix × 10 × factor · Total (g) = max(YAN_target − YAN_must, 0) × L / (N_fraction × 1000)"
          notes="Scott Labs YAN factors (0.75 low, 0.90 medium, 1.25 high); split evenly at 12–24 h and 1/3 sugar break (OSU extension guidance)."
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
