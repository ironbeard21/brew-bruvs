// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  abvAlternate,
  HONEY_PPG,
  SUCROSE_PPG,
  sugarToRaiseGravity,
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
  formatWeight,
  parseNumber,
  useOnUnitSystemChange,
} from "./parseNumber";

type SweetenerPreset = "honey" | "sugar" | "custom";

const PRESET_OPTIONS = [
  { value: "honey", label: "Honey (35 PPG)", accessibilityLabel: "Honey at 35 PPG" },
  { value: "sugar", label: "Sugar (46 PPG)", accessibilityLabel: "Sucrose at 46 PPG" },
  { value: "custom", label: "Custom", accessibilityLabel: "Custom PPG" },
] as const;

export function HoneySugarCalculator() {
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [preset, setPreset] = useState<SweetenerPreset>("honey");
  const [ppgText, setPpgText] = useState(String(HONEY_PPG));
  const [volumeText, setVolumeText] = useState(unitSystem === "us" ? "5.0" : "18.9");
  const [currentSgText, setCurrentSgText] = useState("1.000");
  const [targetSgText, setTargetSgText] = useState("1.105");

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
  const currentSg = parseNumber(currentSgText);
  const targetSg = parseNumber(targetSgText);
  const ppgVal = parseNumber(ppgText);

  const volumeL =
    volVal === null ? null : unitSystem === "us" ? units.gallonsToLiters(volVal) : volVal;

  const result =
    volumeL !== null && currentSg !== null && targetSg !== null && ppgVal !== null
      ? sugarToRaiseGravity({
          volumeL,
          currentSg,
          targetSg,
          pointsPerPoundPerGallon: ppgVal,
        })
      : null;

  const potentialAbv = targetSg !== null && targetSg >= 1.0 ? abvAlternate(targetSg, 1.0) : null;

  const errorMessage =
    volVal === null || currentSg === null || targetSg === null || ppgVal === null
      ? "Enter batch volume, current gravity, target gravity, and fermentable potential."
      : result && !result.ok
        ? result.error.message
        : null;

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Honey & Sugar to Target Gravity</Text>
        <Text style={styles.sectionSubtitle}>
          Calculate honey or sugar weight to build a mead must or raise gravity to a target SG.
        </Text>

        <SegmentedControl
          options={PRESET_OPTIONS}
          value={preset}
          onChange={handlePreset}
          accessibilityLabel="Sweetener potential preset"
        />

        <TextField
          label="Potential (PPG)"
          value={ppgText}
          onChangeText={(v) => {
            setPpgText(v);
            setPreset("custom");
          }}
          unit="PPG"
          keyboardType="decimal-pad"
          helper="Honey varies ~34–38 PPG by moisture; table sugar is 46 PPG"
          testID="honey-ppg-input"
        />
        <TextField
          label="Batch Volume"
          value={volumeText}
          onChangeText={setVolumeText}
          unit={volUnit}
          keyboardType="decimal-pad"
          testID="honey-volume-input"
        />
        <TextField
          label="Current Gravity"
          value={currentSgText}
          onChangeText={setCurrentSgText}
          unit="SG"
          keyboardType="decimal-pad"
          helper="Use 1.000 when starting from water"
          testID="honey-current-sg-input"
        />
        <TextField
          label="Target Gravity"
          value={targetSgText}
          onChangeText={setTargetSgText}
          unit="SG"
          keyboardType="decimal-pad"
          testID="honey-target-sg-input"
        />
      </Card>

      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Amount Needed</Text>
        {errorMessage ? (
          <Banner tone="error" message={errorMessage} testID="honey-error" />
        ) : result?.ok ? (
          <View style={styles.resultsList}>
            <ResultRow
              label={preset === "sugar" ? "Sugar Needed" : "Honey / Sugar Needed"}
              value={formatWeight(result.value, unitSystem)}
              subtitle={
                unitSystem === "us"
                  ? `${formatFixed(result.value, 3)} kg (${Math.round(result.value * 1000)} g)`
                  : `${formatFixed(units.kgToLb(result.value), 2)} lb`
              }
              highlight
              testID="honey-weight-result"
            />
            {potentialAbv?.ok ? (
              <ResultRow
                label="Potential ABV (if fermented dry to 1.000)"
                value={`${formatFixed(potentialAbv.value, 1)}%`}
                subtitle="Alternate formula"
                testID="honey-potential-abv"
              />
            ) : null}
            <SaveToBatchNote
              calculatorName="Honey & Sugar"
              noteBody={`${volumeText} ${volUnit} from ${currentSgText} to ${targetSgText} SG (${ppgText} PPG) → add ${formatWeight(result.value, unitSystem)}`}
            />
          </View>
        ) : null}

        <FormulaDisclosure
          formula="pounds = (SG_target − SG_current) × 1000 × US gal / PPG · kg = lb × 0.45359237"
          notes="Default honey potential is 35 PPG (adjust to match honey moisture content). Sucrose is 46 PPG."
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
