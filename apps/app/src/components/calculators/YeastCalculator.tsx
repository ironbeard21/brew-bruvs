// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  ALE_PITCH_RATE,
  cellsNeeded,
  LAGER_PITCH_RATE,
  packsNeeded,
  starterCells,
  units,
} from "@brew-bruvs/brew-math";
import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { DESKTOP_BREAKPOINT, spacing, type ThemeColors } from "../../theme";
import { Banner, Card, ResultRow, SegmentedControl, TextField } from "../ui";
import { FormulaDisclosure, SaveToBatchNote } from "./CalculatorExtras";
import { convertText, parseNumber, useOnUnitSystemChange } from "./parseNumber";

type PitchPreset = "ale" | "lager" | "custom";

const PRESET_OPTIONS = [
  { value: "ale", label: "Ale (0.75)", accessibilityLabel: "Ale pitch rate 0.75" },
  { value: "lager", label: "Lager (1.50)", accessibilityLabel: "Lager pitch rate 1.50" },
  { value: "custom", label: "Custom", accessibilityLabel: "Custom pitch rate" },
] as const;

export function YeastCalculator() {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [preset, setPreset] = useState<PitchPreset>("ale");
  const [pitchRateText, setPitchRateText] = useState(String(ALE_PITCH_RATE));
  const [volumeText, setVolumeText] = useState(unitSystem === "us" ? "5.25" : "20.0");
  const [ogText, setOgText] = useState("1.055");
  const [cellsPerPackText, setCellsPerPackText] = useState("100");
  const [starterVolText, setStarterVolText] = useState(unitSystem === "us" ? "1.6" : "1.5");
  const [starterSgText, setStarterSgText] = useState("1.036");

  useOnUnitSystemChange(unitSystem, (next) => {
    setVolumeText((v) =>
      convertText(v, next === "us" ? units.litersToGallons : units.gallonsToLiters, 2),
    );
    setStarterVolText((v) =>
      convertText(v, next === "us" ? units.litersToQuarts : units.quartsToLiters, 2),
    );
  });

  const handlePresetChange = (next: PitchPreset) => {
    setPreset(next);
    if (next === "ale") setPitchRateText(String(ALE_PITCH_RATE));
    if (next === "lager") setPitchRateText(String(LAGER_PITCH_RATE));
  };

  const volUnit = unitSystem === "us" ? "US gal" : "L";
  const starterUnit = unitSystem === "us" ? "US qt" : "L";

  const volVal = parseNumber(volumeText);
  const ogVal = parseNumber(ogText);
  const rateVal = parseNumber(pitchRateText);
  const perPackVal = parseNumber(cellsPerPackText);
  const starterVolVal = parseNumber(starterVolText);
  const starterSgVal = parseNumber(starterSgText);

  const volumeL =
    volVal === null ? null : unitSystem === "us" ? units.gallonsToLiters(volVal) : volVal;
  const starterVolumeL =
    starterVolVal === null
      ? null
      : unitSystem === "us"
        ? units.quartsToLiters(starterVolVal)
        : starterVolVal;

  const neededResult =
    volumeL !== null && ogVal !== null && rateVal !== null
      ? cellsNeeded(volumeL, ogVal, rateVal)
      : null;
  const packsResult =
    neededResult?.ok && perPackVal !== null ? packsNeeded(neededResult.value, perPackVal) : null;
  const starterResult =
    perPackVal !== null && starterVolumeL !== null && starterSgVal !== null
      ? starterCells({
          initialCellsBillion: perPackVal,
          starterVolumeL,
          starterSg: starterSgVal,
        })
      : null;

  const errorMessage =
    volVal === null || ogVal === null || rateVal === null || perPackVal === null
      ? "Enter batch volume, original gravity, pitch rate, and viable cells per pack."
      : neededResult && !neededResult.ok
        ? neededResult.error.message
        : packsResult && !packsResult.ok
          ? packsResult.error.message
          : null;

  const starterError =
    starterVolVal === null || starterSgVal === null
      ? null
      : starterResult && !starterResult.ok
        ? starterResult.error.message
        : null;

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Yeast Pitch Rate & Starter</Text>
        <Text style={styles.sectionSubtitle}>
          Calculate yeast cells needed, whole packs required, and stir-plate starter growth.
        </Text>

        <SegmentedControl
          options={PRESET_OPTIONS}
          value={preset}
          onChange={handlePresetChange}
          accessibilityLabel="Yeast pitch rate preset"
        />

        <TextField
          label="Pitch Rate"
          value={pitchRateText}
          onChangeText={(v) => {
            setPitchRateText(v);
            setPreset("custom");
          }}
          unit="M/mL/°P"
          keyboardType="decimal-pad"
          testID="yeast-rate-input"
        />

        <TextField
          label="Batch Volume"
          value={volumeText}
          onChangeText={setVolumeText}
          unit={volUnit}
          keyboardType="decimal-pad"
          testID="yeast-volume-input"
        />

        <TextField
          label="Original Gravity"
          value={ogText}
          onChangeText={setOgText}
          unit="SG"
          keyboardType="decimal-pad"
          testID="yeast-og-input"
        />

        <TextField
          label="Viable Cells per Pack"
          value={cellsPerPackText}
          onChangeText={setCellsPerPackText}
          unit="B cells"
          keyboardType="decimal-pad"
          helper="Liquid pack ≈ 100B · Dry sachet ≈ 150–200B"
          testID="yeast-pack-cells-input"
        />

        <Text style={styles.subHeader}>Stir-Plate Starter (1 pack)</Text>
        <TextField
          label="Starter Volume"
          value={starterVolText}
          onChangeText={setStarterVolText}
          unit={starterUnit}
          keyboardType="decimal-pad"
          testID="yeast-starter-vol-input"
        />
        <TextField
          label="Starter Gravity"
          value={starterSgText}
          onChangeText={setStarterSgText}
          unit="SG"
          keyboardType="decimal-pad"
          helper="Typical DME starter: 1.036–1.040 SG"
          testID="yeast-starter-sg-input"
        />
      </Card>

      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Pitching Summary</Text>
        {errorMessage ? (
          <Banner tone="error" message={errorMessage} testID="yeast-error" />
        ) : neededResult?.ok && packsResult?.ok ? (
          <View style={styles.resultsList}>
            <ResultRow
              label="Cells Needed"
              value={`${Math.round(neededResult.value)} B`}
              subtitle={`At ${pitchRateText} M cells / mL / °P`}
              highlight
              testID="yeast-cells-needed-result"
            />
            <ResultRow
              label="Packs Needed (no starter)"
              value={`${packsResult.value} ${packsResult.value === 1 ? "pack" : "packs"}`}
              subtitle={`At ${cellsPerPackText}B viable cells per pack`}
              testID="yeast-packs-result"
            />
            {starterError ? (
              <Banner tone="error" message={starterError} testID="yeast-starter-error" />
            ) : starterResult?.ok ? (
              <>
                <ResultRow
                  label="Stir-Plate Starter Total"
                  value={`${Math.round(starterResult.value.totalCellsBillion)} B`}
                  subtitle={`+${Math.round(starterResult.value.newCellsBillion)}B new cells (${Math.round(starterResult.value.extractG)} g extract)`}
                  testID="yeast-starter-total-result"
                />
                <Banner
                  tone={
                    starterResult.value.totalCellsBillion >= neededResult.value ? "success" : "info"
                  }
                  message={
                    starterResult.value.totalCellsBillion >= neededResult.value
                      ? "Starter meets your target pitch rate."
                      : `Starter is short by ~${Math.round(neededResult.value - starterResult.value.totalCellsBillion)}B cells — increase starter size or pitch an extra pack.`
                  }
                  testID="yeast-starter-status"
                />
              </>
            ) : null}

            <SaveToBatchNote
              calculatorName="Yeast Pitch"
              noteBody={`${volumeText} ${volUnit} at ${ogText} SG (${pitchRateText} M/mL/°P) → ${Math.round(neededResult.value)}B cells needed (${packsResult.value} packs${starterResult?.ok ? `, ${starterVolText} ${starterUnit} starter yields ${Math.round(starterResult.value.totalCellsBillion)}B` : ""})`}
            />
          </View>
        ) : null}

        <FormulaDisclosure
          formula="Cells (B) = rate × mL × °P / 1000 · Starter growth (Troester): 1.4 B/g (<1.4 B/g), 2.33 − 0.67·rate (1.4–3.5 B/g), 0 (>3.5 B/g)"
          notes="Standard rates: 0.75 M/mL/°P for ales, 1.5 M/mL/°P for lagers. Starter growth uses Kai Troester's stir-plate model."
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
    subHeader: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: spacing.xs },
    resultsList: { gap: spacing.sm },
  });
