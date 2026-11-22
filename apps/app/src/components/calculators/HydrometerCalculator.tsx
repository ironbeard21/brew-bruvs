// SPDX-License-Identifier: AGPL-3.0-or-later
import { correctHydrometer, units } from "@brew-bruvs/brew-math";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { type UnitSystem, useUnits } from "../../state/units";
import { colors, DESKTOP_BREAKPOINT, spacing } from "../../theme";
import { Banner, Card, ResultRow, TextField } from "../ui";
import { formatFixed, parseNumber } from "./parseNumber";

export function HydrometerCalculator() {
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [readingText, setReadingText] = useState("1.050");
  const [sampleTempText, setSampleTempText] = useState(unitSystem === "us" ? "75" : "23.9");
  const [calTempText, setCalTempText] = useState(unitSystem === "us" ? "60" : "15.6");
  const prevUnitRef = useRef<UnitSystem>(unitSystem);

  useEffect(() => {
    if (prevUnitRef.current === unitSystem) return;
    prevUnitRef.current = unitSystem;

    const convert = (raw: string): string => {
      const n = parseNumber(raw);
      if (n === null) return raw;
      return formatFixed(unitSystem === "us" ? units.cToF(n) : units.fToC(n), 1);
    };

    setSampleTempText((prev) => convert(prev));
    setCalTempText((prev) => convert(prev));
  }, [unitSystem]);

  const reading = parseNumber(readingText);
  const sampleTemp = parseNumber(sampleTempText);
  const calTemp = parseNumber(calTempText);

  const sampleTempC =
    sampleTemp === null ? null : unitSystem === "us" ? units.fToC(sampleTemp) : sampleTemp;
  const calTempC = calTemp === null ? null : unitSystem === "us" ? units.fToC(calTemp) : calTemp;

  const result =
    reading !== null && sampleTempC !== null && calTempC !== null
      ? correctHydrometer(reading, sampleTempC, calTempC)
      : null;

  const tempUnit = unitSystem === "us" ? "°F" : "°C";
  const errorMessage =
    reading === null || sampleTemp === null || calTemp === null
      ? "Enter reading, sample temperature, and calibration temperature."
      : result && !result.ok
        ? result.error.message
        : null;

  const delta = result?.ok && reading !== null ? result.value - reading : 0;
  const deltaFormatted = `${delta >= 0 ? "+" : ""}${formatFixed(delta, 4)}`;

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={styles.column}>
        <Text style={styles.sectionTitle}>Hydrometer Temperature Correction</Text>
        <Text style={styles.sectionSubtitle}>
          Adjust a hydrometer reading taken above or below the instrument&apos;s calibration
          temperature.
        </Text>

        <TextField
          label="Measured Reading"
          value={readingText}
          onChangeText={setReadingText}
          unit="SG"
          placeholder="1.050"
          keyboardType="decimal-pad"
          testID="hydro-reading-input"
        />

        <TextField
          label="Sample Temperature"
          value={sampleTempText}
          onChangeText={setSampleTempText}
          unit={tempUnit}
          placeholder={unitSystem === "us" ? "75" : "24"}
          keyboardType="decimal-pad"
          helper={unitSystem === "us" ? "Valid range: 32–140 °F" : "Valid range: 0–60 °C"}
          testID="hydro-sample-temp-input"
        />

        <TextField
          label="Calibration Temperature"
          value={calTempText}
          onChangeText={setCalTempText}
          unit={tempUnit}
          placeholder={unitSystem === "us" ? "60" : "15.6"}
          keyboardType="decimal-pad"
          helper={unitSystem === "us" ? "Commonly 60 °F or 68 °F" : "Commonly 15.6 °C or 20 °C"}
          testID="hydro-cal-temp-input"
        />
      </Card>

      <Card style={styles.column}>
        <Text style={styles.sectionTitle}>Corrected Gravity</Text>

        {errorMessage ? (
          <Banner tone="error" message={errorMessage} testID="hydro-error" />
        ) : result?.ok ? (
          <View style={styles.resultsList}>
            <ResultRow
              label="Corrected Gravity"
              value={formatFixed(result.value, 3)}
              subtitle="Specific Gravity (SG)"
              highlight
              testID="hydro-corrected-result"
            />
            <ResultRow
              label="Gravity Correction"
              value={deltaFormatted}
              subtitle="Difference from measured reading"
              testID="hydro-delta-result"
            />
            <ResultRow
              label="Equivalent Extract"
              value={`${formatFixed(units.sgToPlato(result.value), 1)} °P`}
              testID="hydro-plato-result"
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
