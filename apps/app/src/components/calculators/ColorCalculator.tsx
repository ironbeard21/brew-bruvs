// SPDX-License-Identifier: AGPL-3.0-or-later
import { type GrainColor, mcu, moreySrm, units } from "@brew-bruvs/brew-math";
import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { DESKTOP_BREAKPOINT, radii, spacing, type ThemeColors } from "../../theme";
import { Banner, Button, Card, ResultRow, TextField } from "../ui";
import { FormulaDisclosure, SaveToBatchNote } from "./CalculatorExtras";
import { convertText, formatFixed, parseNumber, useOnUnitSystemChange } from "./parseNumber";

interface GrainRow {
  id: number;
  weightText: string;
  lovibondText: string;
}

// Display-only SRM beer color swatch table (standard BJCP/Morey visual reference).
const SRM_HEX_STOPS: readonly string[] = [
  "#FFE699",
  "#FFD878",
  "#FFCA5A",
  "#FFBF42",
  "#FBB123",
  "#F8A600",
  "#F39C00",
  "#EA8F00",
  "#E58500",
  "#DE7C00",
  "#D77200",
  "#CF6900",
  "#CB6200",
  "#C35900",
  "#BB5100",
  "#B54C00",
  "#B04500",
  "#A63E00",
  "#A13700",
  "#9B3200",
  "#952D00",
  "#8E2900",
  "#882300",
  "#821E00",
  "#7B1A00",
  "#771900",
  "#701400",
  "#6A0E00",
  "#660D00",
  "#5E0B00",
  "#5A0A02",
  "#560A05",
  "#520907",
  "#4C0505",
  "#470606",
  "#440607",
  "#3F0708",
  "#3B0607",
  "#3A070B",
  "#36080A",
];

function srmToDisplayHex(srm: number): string {
  const index = Math.max(0, Math.min(SRM_HEX_STOPS.length - 1, Math.round(srm) - 1));
  return SRM_HEX_STOPS[index] ?? "#36080A";
}

export function ColorCalculator() {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [volumeText, setVolumeText] = useState(unitSystem === "us" ? "5.0" : "18.9");
  const [nextId, setNextId] = useState(3);
  const [grains, setGrains] = useState<GrainRow[]>([
    { id: 1, weightText: unitSystem === "us" ? "9.0" : "4.08", lovibondText: "2" },
    { id: 2, weightText: unitSystem === "us" ? "1.0" : "0.45", lovibondText: "60" },
  ]);

  useOnUnitSystemChange(unitSystem, (next) => {
    setVolumeText((v) =>
      convertText(v, next === "us" ? units.litersToGallons : units.gallonsToLiters, 2),
    );
    setGrains((rows) =>
      rows.map((r) => ({
        ...r,
        weightText: convertText(r.weightText, next === "us" ? units.kgToLb : units.lbToKg, 2),
      })),
    );
  });

  const volUnit = unitSystem === "us" ? "US gal" : "L";
  const massUnit = unitSystem === "us" ? "lb" : "kg";

  const volVal = parseNumber(volumeText);
  const volumeL =
    volVal === null ? null : unitSystem === "us" ? units.gallonsToLiters(volVal) : volVal;

  const parsedGrains: GrainColor[] = [];
  for (const row of grains) {
    const w = parseNumber(row.weightText);
    const l = parseNumber(row.lovibondText);
    if (w === null || l === null) {
      parsedGrains.length = 0;
      break;
    }
    parsedGrains.push({ kg: unitSystem === "us" ? units.lbToKg(w) : w, lovibond: l });
  }

  const allParsed = volumeL !== null && grains.length > 0 && parsedGrains.length === grains.length;
  const srmResult = allParsed ? moreySrm(parsedGrains, volumeL) : null;
  const mcuResult = allParsed ? mcu(parsedGrains, volumeL) : null;

  const errorMessage =
    grains.length === 0
      ? "Add at least one fermentable."
      : !allParsed
        ? "Enter batch volume and every fermentable's weight and color."
        : srmResult && !srmResult.ok
          ? srmResult.error.message
          : null;

  const updateGrain = (id: number, patch: Partial<GrainRow>) => {
    setGrains((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addGrain = () => {
    setGrains((rows) => [
      ...rows,
      { id: nextId, weightText: unitSystem === "us" ? "0.5" : "0.23", lovibondText: "40" },
    ]);
    setNextId((id) => id + 1);
  };

  const removeGrain = (id: number) => {
    setGrains((rows) => rows.filter((r) => r.id !== id));
  };

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Beer Color (Morey SRM / EBC)</Text>
        <Text style={styles.sectionSubtitle}>
          Estimate finished beer color from your grain bill using the Morey equation.
        </Text>

        <TextField
          label="Batch Volume"
          value={volumeText}
          onChangeText={setVolumeText}
          unit={volUnit}
          keyboardType="decimal-pad"
          testID="color-volume-input"
        />

        <View style={styles.listStack}>
          {grains.map((grain, idx) => (
            <View key={grain.id} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>Fermentable {idx + 1}</Text>
                {grains.length > 1 ? (
                  <Button
                    label="Remove"
                    variant="ghost"
                    onPress={() => removeGrain(grain.id)}
                    accessibilityLabel={`Remove fermentable ${idx + 1}`}
                  />
                ) : null}
              </View>
              <View style={styles.rowPair}>
                <View style={styles.flexOne}>
                  <TextField
                    label="Weight"
                    value={grain.weightText}
                    onChangeText={(v) => updateGrain(grain.id, { weightText: v })}
                    unit={massUnit}
                    keyboardType="decimal-pad"
                    accessibilityLabel={`Fermentable ${idx + 1} weight in ${massUnit}`}
                    testID={`color-grain-${idx}-weight`}
                  />
                </View>
                <View style={styles.flexOne}>
                  <TextField
                    label="Color"
                    value={grain.lovibondText}
                    onChangeText={(v) => updateGrain(grain.id, { lovibondText: v })}
                    unit="°L"
                    keyboardType="decimal-pad"
                    accessibilityLabel={`Fermentable ${idx + 1} color in Lovibond`}
                    testID={`color-grain-${idx}-lovibond`}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>

        <Button
          label="Add fermentable"
          variant="secondary"
          onPress={addGrain}
          testID="color-add-grain"
        />
      </Card>

      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Estimated Color</Text>
        {errorMessage ? (
          <Banner tone="error" message={errorMessage} testID="color-error" />
        ) : srmResult?.ok && mcuResult?.ok ? (
          <View style={styles.resultsList}>
            <View
              style={[styles.swatchBar, { backgroundColor: srmToDisplayHex(srmResult.value) }]}
              accessible
              accessibilityLabel={`Estimated beer color swatch for ${formatFixed(srmResult.value, 1)} SRM`}
              testID="color-swatch"
            />
            <ResultRow
              label="Color (SRM)"
              value={`${formatFixed(srmResult.value, 1)} SRM`}
              subtitle="Morey (1994)"
              highlight
              testID="color-srm-result"
            />
            <ResultRow
              label="Color (EBC)"
              value={`${formatFixed(units.srmToEbc(srmResult.value), 1)} EBC`}
              testID="color-ebc-result"
            />
            <ResultRow
              label="Malt Color Units (MCU)"
              value={formatFixed(mcuResult.value, 1)}
              testID="color-mcu-result"
            />
            <SaveToBatchNote
              calculatorName="Beer Color"
              noteBody={`${formatFixed(srmResult.value, 1)} SRM (${formatFixed(units.srmToEbc(srmResult.value), 1)} EBC, ${formatFixed(mcuResult.value, 1)} MCU) in ${volumeText} ${volUnit}`}
            />
          </View>
        ) : null}

        <FormulaDisclosure
          formula="MCU = Σ(lb × °L) / US gal · SRM = 1.4922 × MCU^0.6859 · EBC = SRM × 1.97"
          notes="Dan Morey (1994) nonlinear approximation for beer color from malt color units."
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
    rowPair: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
    flexOne: { flex: 1, minWidth: 110 },
    listStack: { gap: spacing.sm },
    itemCard: {
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.sm,
    },
    itemHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    itemTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
    swatchBar: {
      height: 44,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    resultsList: { gap: spacing.sm },
  });
