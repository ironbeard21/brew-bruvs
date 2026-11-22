// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  abvAlternate,
  abvStandard,
  apparentAttenuation,
  caloriesPer355ml,
  realAttenuation,
  units,
} from "@brew-bruvs/brew-math";
import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useUnits } from "../../state/units";
import { colors, DESKTOP_BREAKPOINT, spacing } from "../../theme";
import { Banner, Card, ResultRow, SegmentedControl, TextField } from "../ui";
import { formatFixed, parseNumber } from "./parseNumber";

type GravityScale = "sg" | "plato";

const SCALE_OPTIONS = [
  { value: "sg", label: "Specific Gravity (SG)", accessibilityLabel: "Input in Specific Gravity" },
  { value: "plato", label: "°Plato / Brix", accessibilityLabel: "Input in Plato or Brix" },
] as const;

export function AbvCalculator() {
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [scale, setScale] = useState<GravityScale>("sg");
  const [ogText, setOgText] = useState("1.055");
  const [fgText, setFgText] = useState("1.012");

  const handleScaleChange = (next: GravityScale) => {
    if (next === scale) return;
    const ogNum = parseNumber(ogText);
    const fgNum = parseNumber(fgText);
    if (next === "plato") {
      if (ogNum !== null && ogNum >= 0.98 && ogNum <= 1.2) {
        setOgText(formatFixed(units.sgToPlato(ogNum), 1));
      }
      if (fgNum !== null && fgNum >= 0.98 && fgNum <= 1.2) {
        setFgText(formatFixed(units.sgToPlato(fgNum), 1));
      }
    } else {
      if (ogNum !== null && ogNum >= 0 && ogNum <= 45) {
        setOgText(formatFixed(units.platoToSg(ogNum), 3));
      }
      if (fgNum !== null && fgNum >= -5 && fgNum <= 45) {
        setFgText(formatFixed(units.platoToSg(fgNum), 3));
      }
    }
    setScale(next);
  };

  const ogParsed = parseNumber(ogText);
  const fgParsed = parseNumber(fgText);

  const ogSg = ogParsed === null ? null : scale === "sg" ? ogParsed : units.platoToSg(ogParsed);
  const fgSg = fgParsed === null ? null : scale === "sg" ? fgParsed : units.platoToSg(fgParsed);

  const stdResult = ogSg !== null && fgSg !== null ? abvStandard(ogSg, fgSg) : null;
  const altResult = ogSg !== null && fgSg !== null ? abvAlternate(ogSg, fgSg) : null;
  const appAttResult = ogSg !== null && fgSg !== null ? apparentAttenuation(ogSg, fgSg) : null;
  const realAttResult = ogSg !== null && fgSg !== null ? realAttenuation(ogSg, fgSg) : null;
  const calResult = ogSg !== null && fgSg !== null ? caloriesPer355ml(ogSg, fgSg) : null;

  const errorMessage =
    ogParsed === null || fgParsed === null
      ? "Enter both original and final gravity to calculate."
      : stdResult && !stdResult.ok
        ? stdResult.error.message
        : null;

  const unitLabel = scale === "sg" ? "SG" : "°P";

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={styles.column}>
        <Text style={styles.sectionTitle}>ABV, Attenuation & Calories</Text>
        <Text style={styles.sectionSubtitle}>
          Calculate alcohol by volume, fermentation attenuation, and calories from original and
          final gravity.
        </Text>

        <SegmentedControl
          options={SCALE_OPTIONS}
          value={scale}
          onChange={handleScaleChange}
          accessibilityLabel="Gravity input scale"
        />

        <TextField
          label="Original Gravity (OG)"
          value={ogText}
          onChangeText={setOgText}
          unit={unitLabel}
          placeholder={scale === "sg" ? "1.055" : "13.6"}
          keyboardType="decimal-pad"
          testID="abv-og-input"
          accessibilityLabel={`Original gravity in ${unitLabel}`}
        />

        <TextField
          label="Final Gravity (FG)"
          value={fgText}
          onChangeText={setFgText}
          unit={unitLabel}
          placeholder={scale === "sg" ? "1.012" : "3.1"}
          keyboardType="decimal-pad"
          testID="abv-fg-input"
          accessibilityLabel={`Final gravity in ${unitLabel}`}
        />
      </Card>

      <Card style={styles.column}>
        <Text style={styles.sectionTitle}>Results</Text>

        {errorMessage ? (
          <Banner tone="error" message={errorMessage} testID="abv-error" />
        ) : stdResult?.ok && altResult?.ok && calResult?.ok ? (
          <View style={styles.resultsList}>
            <ResultRow
              label="ABV (Standard)"
              subtitle="Best below ~8% ABV"
              value={`${formatFixed(stdResult.value, 2)}%`}
              highlight
              testID="abv-standard-result"
            />
            <ResultRow
              label="ABV (Alternate)"
              subtitle="More accurate for high-gravity beers, meads & wines"
              value={`${formatFixed(altResult.value, 2)}%`}
              testID="abv-alternate-result"
            />
            {appAttResult?.ok ? (
              <ResultRow
                label="Apparent Attenuation"
                value={`${formatFixed(appAttResult.value, 1)}%`}
                testID="abv-apparent-attenuation"
              />
            ) : null}
            {realAttResult?.ok ? (
              <ResultRow
                label="Real Attenuation"
                subtitle="Balling real extract"
                value={`${formatFixed(realAttResult.value, 1)}%`}
                testID="abv-real-attenuation"
              />
            ) : null}
            <ResultRow
              label="Calories"
              subtitle={unitSystem === "us" ? "per 12 US fl oz" : "per 355 mL"}
              value={`${Math.round(calResult.value)} kcal`}
              testID="abv-calories-result"
            />
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  layout: {
    gap: spacing.lg,
  },
  layoutDesktop: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  column: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  sectionSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  resultsList: {
    gap: spacing.sm,
  },
});
