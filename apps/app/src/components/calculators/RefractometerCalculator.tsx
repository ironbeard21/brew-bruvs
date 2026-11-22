// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  abvAlternate,
  abvStandard,
  DEFAULT_WORT_CORRECTION,
  refractometerFinalGravity,
  refractometerSg,
  units,
} from "@brew-bruvs/brew-math";
import { useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { colors, DESKTOP_BREAKPOINT, spacing } from "../../theme";
import { Banner, Card, ResultRow, SegmentedControl, TextField } from "../ui";
import { formatFixed, parseNumber } from "./parseNumber";

type RefractometerMode = "unfermented" | "fermenting";

const MODE_OPTIONS = [
  { value: "unfermented", label: "Unfermented Wort" },
  { value: "fermenting", label: "Fermenting / Finished" },
] as const;

export function RefractometerCalculator() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [mode, setMode] = useState<RefractometerMode>("fermenting");
  const [ogBrixText, setOgBrixText] = useState("13.5");
  const [currentBrixText, setCurrentBrixText] = useState("6.8");
  const [wcfText, setWcfText] = useState(String(DEFAULT_WORT_CORRECTION));

  const ogBrix = parseNumber(ogBrixText);
  const currentBrix = parseNumber(currentBrixText);
  const wcf = parseNumber(wcfText);

  const unfermentedResult =
    mode === "unfermented" && ogBrix !== null && wcf !== null ? refractometerSg(ogBrix, wcf) : null;

  const fermentingOgResult =
    mode === "fermenting" && ogBrix !== null && wcf !== null ? refractometerSg(ogBrix, wcf) : null;
  const fermentingFgResult =
    mode === "fermenting" && ogBrix !== null && currentBrix !== null && wcf !== null
      ? refractometerFinalGravity(ogBrix, currentBrix, wcf)
      : null;

  const stdAbv =
    fermentingOgResult?.ok && fermentingFgResult?.ok
      ? abvStandard(fermentingOgResult.value, fermentingFgResult.value)
      : null;
  const altAbv =
    fermentingOgResult?.ok && fermentingFgResult?.ok
      ? abvAlternate(fermentingOgResult.value, fermentingFgResult.value)
      : null;

  let errorMessage: string | null = null;
  if (mode === "unfermented") {
    if (ogBrix === null || wcf === null) {
      errorMessage = "Enter a Brix reading and wort correction factor.";
    } else if (unfermentedResult && !unfermentedResult.ok) {
      errorMessage = unfermentedResult.error.message;
    }
  } else {
    if (ogBrix === null || currentBrix === null || wcf === null) {
      errorMessage = "Enter original Brix, current Brix, and wort correction factor.";
    } else if (fermentingFgResult && !fermentingFgResult.ok) {
      errorMessage = fermentingFgResult.error.message;
    } else if (fermentingOgResult && !fermentingOgResult.ok) {
      errorMessage = fermentingOgResult.error.message;
    }
  }

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
      <Card style={styles.column}>
        <Text style={styles.sectionTitle}>Refractometer Correction</Text>
        <Text style={styles.sectionSubtitle}>
          Convert Brix to specific gravity with wort correction, or adjust readings during and after
          fermentation using Terrill&apos;s cubic formula.
        </Text>

        <SegmentedControl
          options={MODE_OPTIONS}
          value={mode}
          onChange={setMode}
          accessibilityLabel="Refractometer calculation mode"
        />

        <TextField
          label={mode === "unfermented" ? "Wort Reading" : "Original Reading"}
          value={ogBrixText}
          onChangeText={setOgBrixText}
          unit="°Bx"
          placeholder="13.5"
          keyboardType="decimal-pad"
          testID="refrac-og-brix-input"
        />

        {mode === "fermenting" ? (
          <TextField
            label="Current Reading"
            value={currentBrixText}
            onChangeText={setCurrentBrixText}
            unit="°Bx"
            placeholder="6.8"
            keyboardType="decimal-pad"
            testID="refrac-current-brix-input"
          />
        ) : null}

        <TextField
          label="Wort Correction Factor"
          value={wcfText}
          onChangeText={setWcfText}
          placeholder="1.04"
          keyboardType="decimal-pad"
          helper="Typical default is 1.04 (1.00 for pure sugar/must)"
          testID="refrac-wcf-input"
        />
      </Card>

      <Card style={styles.column}>
        <Text style={styles.sectionTitle}>Results</Text>

        {errorMessage ? (
          <Banner tone="error" message={errorMessage} testID="refrac-error" />
        ) : mode === "unfermented" && unfermentedResult?.ok ? (
          <View style={styles.resultsList}>
            <ResultRow
              label="Original Gravity"
              value={formatFixed(unfermentedResult.value, 3)}
              subtitle="Specific Gravity (SG)"
              highlight
              testID="refrac-unfermented-sg"
            />
            <ResultRow
              label="Corrected Extract"
              value={`${formatFixed(units.sgToPlato(unfermentedResult.value), 1)} °P`}
              testID="refrac-unfermented-plato"
            />
          </View>
        ) : mode === "fermenting" && fermentingOgResult?.ok && fermentingFgResult?.ok ? (
          <View style={styles.resultsList}>
            <ResultRow
              label="Corrected Final Gravity"
              value={formatFixed(fermentingFgResult.value, 3)}
              subtitle="Terrill cubic (alcohol-adjusted SG)"
              highlight
              testID="refrac-fg-result"
            />
            <ResultRow
              label="Original Gravity"
              value={formatFixed(fermentingOgResult.value, 3)}
              subtitle="Specific Gravity (SG)"
              testID="refrac-og-sg-result"
            />
            {stdAbv?.ok ? (
              <ResultRow
                label="Estimated ABV (Standard)"
                value={`${formatFixed(stdAbv.value, 2)}%`}
                testID="refrac-abv-std"
              />
            ) : null}
            {altAbv?.ok ? (
              <ResultRow
                label="Estimated ABV (Alternate)"
                value={`${formatFixed(altAbv.value, 2)}%`}
                testID="refrac-abv-alt"
              />
            ) : null}
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
