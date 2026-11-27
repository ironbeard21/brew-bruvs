// SPDX-License-Identifier: AGPL-3.0-or-later
import { type HopAddition, ragerIbu, tinsethIbu, totalIbu, units } from "@brew-bruvs/brew-math";
import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { DESKTOP_BREAKPOINT, radii, spacing, type ThemeColors } from "../../theme";
import { Banner, Button, Card, ResultRow, SegmentedControl, TextField } from "../ui";
import { FormulaDisclosure, SaveToBatchNote } from "./CalculatorExtras";
import { convertText, formatFixed, parseNumber, useOnUnitSystemChange } from "./parseNumber";

type IbuMethod = "tinseth" | "rager";

interface HopRow {
  id: number;
  weightText: string;
  aaText: string;
  minutesText: string;
}

const METHOD_OPTIONS = [
  { value: "tinseth", label: "Tinseth", accessibilityLabel: "Tinseth IBU formula" },
  { value: "rager", label: "Rager", accessibilityLabel: "Rager IBU formula" },
] as const;

export function IbuCalculator() {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [method, setMethod] = useState<IbuMethod>("tinseth");
  const [volumeText, setVolumeText] = useState(unitSystem === "us" ? "5.0" : "18.9");
  const [boilSgText, setBoilSgText] = useState("1.050");
  const [nextId, setNextId] = useState(3);
  const [hops, setHops] = useState<HopRow[]>([
    { id: 1, weightText: unitSystem === "us" ? "1.0" : "28.3", aaText: "6.5", minutesText: "60" },
    { id: 2, weightText: unitSystem === "us" ? "1.0" : "28.3", aaText: "5.5", minutesText: "15" },
  ]);

  useOnUnitSystemChange(unitSystem, (next) => {
    setVolumeText((v) =>
      convertText(v, next === "us" ? units.litersToGallons : units.gallonsToLiters, 2),
    );
    setHops((rows) =>
      rows.map((r) => ({
        ...r,
        weightText: convertText(r.weightText, next === "us" ? units.gToOz : units.ozToG, 1),
      })),
    );
  });

  const volUnit = unitSystem === "us" ? "US gal" : "L";
  const hopUnit = unitSystem === "us" ? "oz" : "g";

  const volVal = parseNumber(volumeText);
  const boilSgVal = parseNumber(boilSgText);
  const volumeL =
    volVal === null ? null : unitSystem === "us" ? units.gallonsToLiters(volVal) : volVal;

  const parsedAdditions: HopAddition[] | null = [];
  for (const row of hops) {
    const w = parseNumber(row.weightText);
    const aa = parseNumber(row.aaText);
    const m = parseNumber(row.minutesText);
    if (w === null || aa === null || m === null) {
      parsedAdditions.length = 0;
      break;
    }
    parsedAdditions.push({
      hopGrams: unitSystem === "us" ? units.ozToG(w) : w,
      alphaAcidPct: aa,
      minutes: m,
    });
  }

  const allParsed =
    volumeL !== null &&
    boilSgVal !== null &&
    hops.length > 0 &&
    parsedAdditions.length === hops.length;
  const wort = allParsed ? { volumeL, boilSg: boilSgVal } : null;
  const totalResult = wort ? totalIbu(parsedAdditions, wort, method) : null;
  const perHopResults =
    wort && totalResult?.ok
      ? parsedAdditions.map((hop) =>
          method === "tinseth" ? tinsethIbu(hop, wort) : ragerIbu(hop, wort),
        )
      : [];

  const errorMessage =
    hops.length === 0
      ? "Add at least one hop addition."
      : !allParsed
        ? "Enter batch volume, boil gravity, and all hop fields."
        : totalResult && !totalResult.ok
          ? totalResult.error.message
          : null;

  const updateHop = (id: number, patch: Partial<HopRow>) => {
    setHops((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addHop = () => {
    setHops((rows) => [
      ...rows,
      {
        id: nextId,
        weightText: unitSystem === "us" ? "1.0" : "28.3",
        aaText: "5.0",
        minutesText: "10",
      },
    ]);
    setNextId((id) => id + 1);
  };

  const removeHop = (id: number) => {
    setHops((rows) => rows.filter((r) => r.id !== id));
  };

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>Bitterness (IBU)</Text>
        <Text style={styles.sectionSubtitle}>
          Estimate per-addition and total IBUs using Tinseth or Rager hop utilization.
        </Text>

        <SegmentedControl
          options={METHOD_OPTIONS}
          value={method}
          onChange={setMethod}
          accessibilityLabel="IBU calculation method"
        />

        <View style={styles.rowPair}>
          <View style={styles.flexOne}>
            <TextField
              label="Batch Volume"
              value={volumeText}
              onChangeText={setVolumeText}
              unit={volUnit}
              keyboardType="decimal-pad"
              testID="ibu-volume-input"
            />
          </View>
          <View style={styles.flexOne}>
            <TextField
              label="Boil Gravity"
              value={boilSgText}
              onChangeText={setBoilSgText}
              unit="SG"
              keyboardType="decimal-pad"
              testID="ibu-boil-sg-input"
            />
          </View>
        </View>

        <View style={styles.listStack}>
          {hops.map((hop, idx) => (
            <View key={hop.id} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>Addition {idx + 1}</Text>
                {hops.length > 1 ? (
                  <Button
                    label="Remove"
                    variant="ghost"
                    onPress={() => removeHop(hop.id)}
                    accessibilityLabel={`Remove hop addition ${idx + 1}`}
                  />
                ) : null}
              </View>
              <View style={styles.rowPair}>
                <View style={styles.flexOne}>
                  <TextField
                    label="Weight"
                    value={hop.weightText}
                    onChangeText={(v) => updateHop(hop.id, { weightText: v })}
                    unit={hopUnit}
                    keyboardType="decimal-pad"
                    accessibilityLabel={`Hop ${idx + 1} weight in ${hopUnit}`}
                    testID={`ibu-hop-${idx}-weight`}
                  />
                </View>
                <View style={styles.flexOne}>
                  <TextField
                    label="Alpha Acid"
                    value={hop.aaText}
                    onChangeText={(v) => updateHop(hop.id, { aaText: v })}
                    unit="%"
                    keyboardType="decimal-pad"
                    accessibilityLabel={`Hop ${idx + 1} alpha acid percentage`}
                    testID={`ibu-hop-${idx}-aa`}
                  />
                </View>
                <View style={styles.flexOne}>
                  <TextField
                    label="Boil Time"
                    value={hop.minutesText}
                    onChangeText={(v) => updateHop(hop.id, { minutesText: v })}
                    unit="min"
                    keyboardType="decimal-pad"
                    accessibilityLabel={`Hop ${idx + 1} boil time in minutes`}
                    testID={`ibu-hop-${idx}-min`}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>

        <Button
          label="Add hop addition"
          variant="secondary"
          onPress={addHop}
          testID="ibu-add-hop"
        />
      </Card>

      <Card style={isDesktop ? styles.column : undefined}>
        <Text style={styles.sectionTitle}>IBU Results</Text>
        {errorMessage ? (
          <Banner tone="error" message={errorMessage} testID="ibu-error" />
        ) : totalResult?.ok ? (
          <View style={styles.resultsList}>
            <ResultRow
              label="Total Bitterness"
              value={`${formatFixed(totalResult.value, 1)} IBU`}
              subtitle={method === "tinseth" ? "Tinseth (1997)" : "Rager (1990)"}
              highlight
              testID="ibu-total-result"
            />
            {perHopResults.map((res, idx) =>
              res.ok ? (
                <ResultRow
                  key={hops[idx]?.id ?? idx}
                  label={`Addition ${idx + 1}`}
                  subtitle={`${hops[idx]?.weightText} ${hopUnit} · ${hops[idx]?.aaText}% AA · ${hops[idx]?.minutesText} min`}
                  value={`${formatFixed(res.value, 1)} IBU`}
                  testID={`ibu-hop-${idx}-result`}
                />
              ) : null,
            )}
            <SaveToBatchNote
              calculatorName={`IBU (${method === "tinseth" ? "Tinseth" : "Rager"})`}
              noteBody={`${formatFixed(totalResult.value, 1)} IBU total at ${boilSgText} SG in ${volumeText} ${volUnit} (${hops.length} additions)`}
            />
          </View>
        ) : null}

        <FormulaDisclosure
          formula={
            method === "tinseth"
              ? "IBU = 1.65 × 0.000125^(SG − 1) × ((1 − e^(−0.04·t)) / 4.15) × (AA% × g × 10 / L)"
              : "IBU = ((18.11 + 13.86 × tanh((t − 31.32) / 18.27)) / 100) × (AA% × g × 10 / L) / (1 + GA)"
          }
          notes={
            method === "tinseth"
              ? "Glenn Tinseth (1997) bigness × boil-time utilization multiplied by added alpha acids (mg/L)."
              : "Jackie Rager (1990). Gravity adjustment GA = (boil SG − 1.050) / 0.2 when boil SG > 1.050, else 0."
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
    rowPair: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
    flexOne: { flex: 1, minWidth: 96 },
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
