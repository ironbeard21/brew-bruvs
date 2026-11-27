// SPDX-License-Identifier: AGPL-3.0-or-later
import { blend, type Lot, units } from "@brew-bruvs/brew-math";
import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { DESKTOP_BREAKPOINT, radii, spacing, type ThemeColors } from "../../theme";
import { Banner, Button, Card, ResultRow, TextField } from "../ui";
import { FormulaDisclosure, SaveToBatchNote } from "./CalculatorExtras";
import {
  convertText,
  formatFixed,
  formatVolume,
  parseNumber,
  useOnUnitSystemChange,
} from "./parseNumber";

interface LotRow {
  id: number;
  volumeText: string;
  abvText: string;
  sgText: string;
  taText: string;
}

export function BlendingCalculator() {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [nextId, setNextId] = useState(3);
  const [lots, setLots] = useState<LotRow[]>([
    {
      id: 1,
      volumeText: unitSystem === "us" ? "3.0" : "11.4",
      abvText: "13.0",
      sgText: "0.996",
      taText: "5.5",
    },
    {
      id: 2,
      volumeText: unitSystem === "us" ? "2.0" : "7.6",
      abvText: "10.5",
      sgText: "1.020",
      taText: "7.5",
    },
  ]);

  useOnUnitSystemChange(unitSystem, (next) => {
    setLots((rows) =>
      rows.map((r) => ({
        ...r,
        volumeText: convertText(
          r.volumeText,
          next === "us" ? units.litersToGallons : units.gallonsToLiters,
          2,
        ),
      })),
    );
  });

  const volUnit = unitSystem === "us" ? "US gal" : "L";

  const parsedLots: Lot[] = [];
  let missingVolume = false;
  for (const row of lots) {
    const v = parseNumber(row.volumeText);
    if (v === null) {
      missingVolume = true;
      break;
    }
    const lot: Lot = { volumeL: unitSystem === "us" ? units.gallonsToLiters(v) : v };
    const abv = parseNumber(row.abvText);
    const sg = parseNumber(row.sgText);
    const ta = parseNumber(row.taText);
    if (abv !== null) lot.abv = abv;
    if (sg !== null) lot.sg = sg;
    if (ta !== null) lot.ta = ta;
    parsedLots.push(lot);
  }

  const result = !missingVolume ? blend(parsedLots) : null;

  const errorMessage = missingVolume
    ? "Enter a volume for every lot."
    : result && !result.ok
      ? result.error.message
      : null;

  const updateLot = (id: number, patch: Partial<LotRow>) => {
    setLots((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addLot = () => {
    setLots((rows) => [
      ...rows,
      {
        id: nextId,
        volumeText: unitSystem === "us" ? "1.0" : "3.8",
        abvText: "",
        sgText: "",
        taText: "",
      },
    ]);
    setNextId((id) => id + 1);
  };

  const removeLot = (id: number) => {
    setLots((rows) => rows.filter((r) => r.id !== id));
  };

  const noteParts: string[] = [];
  if (result?.ok) {
    noteParts.push(`Total ${formatVolume(result.value.volumeL, unitSystem)}`);
    if (result.value.abv !== undefined) noteParts.push(`${formatFixed(result.value.abv, 2)}% ABV`);
    if (result.value.sg !== undefined) noteParts.push(`${formatFixed(result.value.sg, 3)} SG`);
    if (result.value.ta !== undefined) noteParts.push(`${formatFixed(result.value.ta, 2)} g/L TA`);
  }

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Blending Calculator</Text>
        <Text style={styles.sectionSubtitle}>
          Compute volume-weighted ABV, specific gravity, and titratable acidity when blending two or
          more lots. Leave optional properties blank if unused.
        </Text>

        <View style={styles.listStack}>
          {lots.map((lot, idx) => (
            <View key={lot.id} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>Lot {idx + 1}</Text>
                {lots.length > 2 ? (
                  <Button
                    label="Remove"
                    variant="ghost"
                    onPress={() => removeLot(lot.id)}
                    accessibilityLabel={`Remove lot ${idx + 1}`}
                  />
                ) : null}
              </View>
              <View style={styles.rowPair}>
                <View style={styles.flexOne}>
                  <TextField
                    label="Volume"
                    value={lot.volumeText}
                    onChangeText={(v) => updateLot(lot.id, { volumeText: v })}
                    unit={volUnit}
                    keyboardType="decimal-pad"
                    accessibilityLabel={`Lot ${idx + 1} volume in ${volUnit}`}
                    testID={`blend-lot-${idx}-volume`}
                  />
                </View>
                <View style={styles.flexOne}>
                  <TextField
                    label="ABV"
                    value={lot.abvText}
                    onChangeText={(v) => updateLot(lot.id, { abvText: v })}
                    unit="%"
                    placeholder="Optional"
                    keyboardType="decimal-pad"
                    accessibilityLabel={`Lot ${idx + 1} ABV percentage`}
                    testID={`blend-lot-${idx}-abv`}
                  />
                </View>
              </View>
              <View style={styles.rowPair}>
                <View style={styles.flexOne}>
                  <TextField
                    label="Gravity"
                    value={lot.sgText}
                    onChangeText={(v) => updateLot(lot.id, { sgText: v })}
                    unit="SG"
                    placeholder="Optional"
                    keyboardType="decimal-pad"
                    accessibilityLabel={`Lot ${idx + 1} specific gravity`}
                    testID={`blend-lot-${idx}-sg`}
                  />
                </View>
                <View style={styles.flexOne}>
                  <TextField
                    label="TA"
                    value={lot.taText}
                    onChangeText={(v) => updateLot(lot.id, { taText: v })}
                    unit="g/L"
                    placeholder="Optional"
                    keyboardType="decimal-pad"
                    accessibilityLabel={`Lot ${idx + 1} titratable acidity`}
                    testID={`blend-lot-${idx}-ta`}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>

        <Button label="Add lot" variant="secondary" onPress={addLot} testID="blend-add-lot" />
      </Card>

      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Blended Result</Text>
        {errorMessage ? (
          <Banner tone="error" message={errorMessage} testID="blend-error" />
        ) : result?.ok ? (
          <View style={styles.resultsList}>
            <ResultRow
              label="Total Volume"
              value={formatVolume(result.value.volumeL, unitSystem)}
              highlight
              testID="blend-volume-result"
            />
            {result.value.abv !== undefined ? (
              <ResultRow
                label="Blended ABV"
                value={`${formatFixed(result.value.abv, 2)}%`}
                testID="blend-abv-result"
              />
            ) : null}
            {result.value.sg !== undefined ? (
              <ResultRow
                label="Blended Gravity"
                value={formatFixed(result.value.sg, 3)}
                subtitle="Specific Gravity (SG)"
                testID="blend-sg-result"
              />
            ) : null}
            {result.value.ta !== undefined ? (
              <ResultRow
                label="Blended TA"
                value={`${formatFixed(result.value.ta, 2)} g/L`}
                testID="blend-ta-result"
              />
            ) : null}
            <SaveToBatchNote
              calculatorName="Blending"
              noteBody={`${lots.length} lots → ${noteParts.join(", ")}`}
            />
          </View>
        ) : null}

        <FormulaDisclosure
          formula="V_total = Σ V_i · Property_blend = Σ (Property_i × V_i) / V_total"
          notes="A blended property (ABV, SG, or TA) is calculated when every lot provides a value for it."
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
    resultsList: { gap: spacing.sm },
  });
