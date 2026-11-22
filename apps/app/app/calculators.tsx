// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { AppShell } from "../src/components/AppShell";
import { AbvCalculator } from "../src/components/calculators/AbvCalculator";
import { HydrometerCalculator } from "../src/components/calculators/HydrometerCalculator";
import { RefractometerCalculator } from "../src/components/calculators/RefractometerCalculator";
import { UnitConverter } from "../src/components/calculators/UnitConverter";
import { SegmentedControl } from "../src/components/ui";
import { spacing } from "../src/theme";

type CalculatorTab = "abv" | "hydrometer" | "refractometer" | "units";

const CALCULATOR_TABS = [
  { value: "abv", label: "ABV", accessibilityLabel: "ABV and attenuation calculator" },
  {
    value: "hydrometer",
    label: "Hydrometer",
    accessibilityLabel: "Hydrometer temperature correction calculator",
  },
  {
    value: "refractometer",
    label: "Refractometer",
    accessibilityLabel: "Refractometer correction calculator",
  },
  { value: "units", label: "Units", accessibilityLabel: "Brewing unit converter" },
] as const;

export default function CalculatorsScreen() {
  const [activeTab, setActiveTab] = useState<CalculatorTab>("abv");

  return (
    <AppShell
      title="Brewing Calculators"
      subtitle="Works offline with no server required. Values convert automatically with the US / Metric toggle."
    >
      <View style={styles.stack}>
        <SegmentedControl
          options={CALCULATOR_TABS}
          value={activeTab}
          onChange={setActiveTab}
          accessibilityLabel="Calculator selector"
        />

        {activeTab === "abv" ? <AbvCalculator /> : null}
        {activeTab === "hydrometer" ? <HydrometerCalculator /> : null}
        {activeTab === "refractometer" ? <RefractometerCalculator /> : null}
        {activeTab === "units" ? <UnitConverter /> : null}
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.lg,
  },
});
