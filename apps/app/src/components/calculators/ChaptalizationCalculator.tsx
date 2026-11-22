// SPDX-License-Identifier: AGPL-3.0-or-later
import { abvAlternate, SUCROSE_PPG, sugarToRaiseGravity, units } from "@brew-bruvs/brew-math";
import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useUnits } from "../../state/units";
import { colors, DESKTOP_BREAKPOINT, spacing } from "../../theme";
import { Banner, Card, ResultRow, TextField } from "../ui";
import { FormulaDisclosure, SaveToBatchNote } from "./CalculatorExtras";
import {
  convertText,
  formatFixed,
  formatWeight,
  parseNumber,
  useOnUnitSystemChange,
} from "./parseNumber";

export function ChaptalizationCalculator() {
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [volumeText, setVolumeText] = useState(unitSystem === "us" ? "5.0" : "18.9");
  const [currentSgText, setCurrentSgText] = useState("1.075");
  const [targetSgText, setTargetSgText] = useState("1.095");
  const [ppgText, setPpgText] = useState(String(SUCROSE_PPG));

  useOnUnitSystemChange(unitSystem, (next) => {
    setVolumeText((v) =>
      convertText(v, next === "us" ? units.litersToGallons : units.gallonsToLiters, 2),
    );
  });

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

  const beforeAbv = currentSg !== null && currentSg >= 1.0 ? abvAlternate(currentSg, 1.0) : null;
  const afterAbv = targetSg !== null && targetSg >= 1.0 ? abvAlternate(targetSg, 1.0) : null;

  const errorMessage =
    volVal === null || currentSg === null || targetSg === null || ppgVal === null
      ? "Enter must volume, current SG, target SG, and sugar potential."
      : result && !result.ok
        ? result.error.message
        : null;

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Chaptalization</Text>
        <Text style={styles.sectionSubtitle}>
          Add sugar to grape must or apple juice before fermentation to boost starting gravity and
          potential alcohol.
        </Text>

        <TextField
          label="Must / Juice Volume"
          value={volumeText}
          onChangeText={setVolumeText}
          unit={volUnit}
          keyboardType="decimal-pad"
          testID="chaptal-volume-input"
        />
        <TextField
          label="Current Must Gravity"
          value={currentSgText}
          onChangeText={setCurrentSgText}
          unit="SG"
          keyboardType="decimal-pad"
          testID="chaptal-current-sg-input"
        />
        <TextField
          label="Target Starting Gravity"
          value={targetSgText}
          onChangeText={setTargetSgText}
          unit="SG"
          keyboardType="decimal-pad"
          testID="chaptal-target-sg-input"
        />
        <TextField
          label="Sugar Potential"
          value={ppgText}
          onChangeText={setPpgText}
          unit="PPG"
          keyboardType="decimal-pad"
          helper="Sucrose (table/cane sugar) is 46 PPG; dextrose is ~42 PPG"
          testID="chaptal-ppg-input"
        />
      </Card>

      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Sugar Addition</Text>
        {errorMessage ? (
          <Banner tone="error" message={errorMessage} testID="chaptal-error" />
        ) : result?.ok ? (
          <View style={styles.resultsList}>
            <ResultRow
              label="Sugar to Add"
              value={formatWeight(result.value, unitSystem)}
              subtitle={
                unitSystem === "us"
                  ? `${formatFixed(result.value, 3)} kg (${Math.round(result.value * 1000)} g)`
                  : `${formatFixed(units.kgToLb(result.value), 2)} lb`
              }
              highlight
              testID="chaptal-sugar-result"
            />
            {beforeAbv?.ok && afterAbv?.ok ? (
              <ResultRow
                label="Potential ABV Boost (dry at 1.000)"
                value={`+${formatFixed(afterAbv.value - beforeAbv.value, 2)}%`}
                subtitle={`${formatFixed(beforeAbv.value, 1)}% → ${formatFixed(afterAbv.value, 1)}%`}
                testID="chaptal-abv-boost"
              />
            ) : null}
            <SaveToBatchNote
              calculatorName="Chaptalization"
              noteBody={`${volumeText} ${volUnit} must ${currentSgText} → ${targetSgText} SG → add ${formatWeight(result.value, unitSystem)} sugar (${ppgText} PPG)`}
            />
          </View>
        ) : null}

        <FormulaDisclosure
          formula="pounds = (SG_target − SG_current) × 1000 × US gal / PPG · kg = lb × 0.45359237"
          notes="Potential ABV estimates use the alternate ABV formula assuming fermentation finishes dry at 1.000 SG."
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
