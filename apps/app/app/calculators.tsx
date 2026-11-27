// SPDX-License-Identifier: AGPL-3.0-or-later
import { useLocalSearchParams } from "expo-router";
import { type ComponentType, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AppShell } from "../src/components/AppShell";
import { AbvCalculator } from "../src/components/calculators/AbvCalculator";
import { AcidCalculator } from "../src/components/calculators/AcidCalculator";
import { BlendingCalculator } from "../src/components/calculators/BlendingCalculator";
import { CarbonationCalculator } from "../src/components/calculators/CarbonationCalculator";
import { ChaptalizationCalculator } from "../src/components/calculators/ChaptalizationCalculator";
import { ColorCalculator } from "../src/components/calculators/ColorCalculator";
import { DilutionCalculator } from "../src/components/calculators/DilutionCalculator";
import { HoneySugarCalculator } from "../src/components/calculators/HoneySugarCalculator";
import { HydrometerCalculator } from "../src/components/calculators/HydrometerCalculator";
import { IbuCalculator } from "../src/components/calculators/IbuCalculator";
import { InfusionCalculator } from "../src/components/calculators/InfusionCalculator";
import { NutrientsCalculator } from "../src/components/calculators/NutrientsCalculator";
import { RefractometerCalculator } from "../src/components/calculators/RefractometerCalculator";
import { StabilizeBacksweetenCalculator } from "../src/components/calculators/StabilizeBacksweetenCalculator";
import { StrikeSpargeCalculator } from "../src/components/calculators/StrikeSpargeCalculator";
import { SulfiteCalculator } from "../src/components/calculators/SulfiteCalculator";
import { UnitConverter } from "../src/components/calculators/UnitConverter";
import { YeastCalculator } from "../src/components/calculators/YeastCalculator";
import { useThemedStyles } from "../src/state/theme";
import { DESKTOP_BREAKPOINT, radii, spacing, type ThemeColors } from "../src/theme";

type CalculatorGroupId = "gravity" | "mash-boil" | "yeast-packaging" | "mead-wine";
type GroupFilter = "all" | CalculatorGroupId;

export type CalculatorId =
  | "abv"
  | "hydrometer"
  | "refractometer"
  | "units"
  | "strike-sparge"
  | "infusion"
  | "ibu"
  | "color"
  | "dilution"
  | "carbonation"
  | "yeast"
  | "honey-sugar"
  | "nutrients"
  | "sulfite"
  | "stabilize"
  | "acid"
  | "chaptalization"
  | "blending";

interface CalculatorEntry {
  id: CalculatorId;
  group: CalculatorGroupId;
  label: string;
  accessibilityLabel: string;
  Component: ComponentType;
}

const GROUPS: readonly { id: CalculatorGroupId; label: string; shortLabel: string }[] = [
  { id: "gravity", label: "Gravity & Units", shortLabel: "Gravity" },
  { id: "mash-boil", label: "Mash & Boil", shortLabel: "Mash & Boil" },
  { id: "yeast-packaging", label: "Yeast & Packaging", shortLabel: "Yeast & Pack" },
  { id: "mead-wine", label: "Mead, Wine & Cider", shortLabel: "Mead & Wine" },
];

const CALCULATORS: readonly CalculatorEntry[] = [
  // Gravity & Units (P0-04 core calculators first for immediate access)
  {
    id: "abv",
    group: "gravity",
    label: "ABV",
    accessibilityLabel: "ABV and attenuation calculator",
    Component: AbvCalculator,
  },
  {
    id: "hydrometer",
    group: "gravity",
    label: "Hydrometer",
    accessibilityLabel: "Hydrometer temperature correction calculator",
    Component: HydrometerCalculator,
  },
  {
    id: "refractometer",
    group: "gravity",
    label: "Refractometer",
    accessibilityLabel: "Refractometer correction calculator",
    Component: RefractometerCalculator,
  },
  {
    id: "units",
    group: "gravity",
    label: "Unit Converter",
    accessibilityLabel: "Brewing unit converter",
    Component: UnitConverter,
  },
  // Mash & Boil
  {
    id: "strike-sparge",
    group: "mash-boil",
    label: "Strike & Sparge",
    accessibilityLabel: "Strike and sparge water calculator",
    Component: StrikeSpargeCalculator,
  },
  {
    id: "infusion",
    group: "mash-boil",
    label: "Infusion",
    accessibilityLabel: "Step infusion water calculator",
    Component: InfusionCalculator,
  },
  {
    id: "ibu",
    group: "mash-boil",
    label: "IBU",
    accessibilityLabel: "IBU bitterness calculator",
    Component: IbuCalculator,
  },
  {
    id: "color",
    group: "mash-boil",
    label: "Color",
    accessibilityLabel: "Beer color SRM and EBC calculator",
    Component: ColorCalculator,
  },
  {
    id: "dilution",
    group: "mash-boil",
    label: "Dilution & Boil-Off",
    accessibilityLabel: "Dilution and boil-off calculator",
    Component: DilutionCalculator,
  },
  // Yeast & Packaging
  {
    id: "carbonation",
    group: "yeast-packaging",
    label: "Carbonation",
    accessibilityLabel: "Carbonation priming sugar and keg PSI calculator",
    Component: CarbonationCalculator,
  },
  {
    id: "yeast",
    group: "yeast-packaging",
    label: "Yeast",
    accessibilityLabel: "Yeast pitch rate and starter calculator",
    Component: YeastCalculator,
  },
  // Mead, Wine & Cider
  {
    id: "honey-sugar",
    group: "mead-wine",
    label: "Honey & Sugar",
    accessibilityLabel: "Honey and sugar to target gravity calculator",
    Component: HoneySugarCalculator,
  },
  {
    id: "nutrients",
    group: "mead-wine",
    label: "Nutrients",
    accessibilityLabel: "Staggered yeast nutrients YAN calculator",
    Component: NutrientsCalculator,
  },
  {
    id: "sulfite",
    group: "mead-wine",
    label: "Sulfite (SO₂)",
    accessibilityLabel: "Sulfite free SO2 and potassium metabisulfite calculator",
    Component: SulfiteCalculator,
  },
  {
    id: "stabilize",
    group: "mead-wine",
    label: "Stabilize & Backsweeten",
    accessibilityLabel: "Stabilize with sorbate and backsweeten calculator",
    Component: StabilizeBacksweetenCalculator,
  },
  {
    id: "acid",
    group: "mead-wine",
    label: "Acid (TA)",
    accessibilityLabel: "Acid adjustment titratable acidity calculator",
    Component: AcidCalculator,
  },
  {
    id: "chaptalization",
    group: "mead-wine",
    label: "Chaptalization",
    accessibilityLabel: "Chaptalization sugar addition calculator",
    Component: ChaptalizationCalculator,
  },
  {
    id: "blending",
    group: "mead-wine",
    label: "Blending",
    accessibilityLabel: "Blending lots calculator",
    Component: BlendingCalculator,
  },
];

function isCalculatorId(value: string): value is CalculatorId {
  return CALCULATORS.some((c) => c.id === value);
}

export default function CalculatorsScreen() {
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const params = useLocalSearchParams<{ calc?: string }>();

  const [activeId, setActiveId] = useState<CalculatorId>(() => {
    const requested = typeof params.calc === "string" ? params.calc : "";
    return isCalculatorId(requested) ? requested : "abv";
  });
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");

  useEffect(() => {
    if (typeof params.calc === "string" && isCalculatorId(params.calc)) {
      setActiveId(params.calc);
    }
  }, [params.calc]);

  const activeEntry = CALCULATORS.find((c) => c.id === activeId) ?? CALCULATORS[0];
  if (!activeEntry) return null;
  const ActiveCalculator = activeEntry.Component;

  const visibleOnMobile =
    groupFilter === "all" ? CALCULATORS : CALCULATORS.filter((c) => c.group === groupFilter);

  return (
    <AppShell
      title="Brewing Calculators"
      subtitle="All 18 calculators run offline with zero network required. Tap Show Formula on any calculator to inspect its math."
    >
      <View style={[styles.workspace, isDesktop && styles.workspaceDesktop]}>
        {isDesktop ? (
          <View
            style={styles.sidebar}
            accessibilityRole="tablist"
            accessibilityLabel="Calculator selector"
          >
            {GROUPS.map((group) => (
              <View key={group.id} style={styles.sidebarGroup}>
                <Text style={styles.groupHeading}>{group.label}</Text>
                {CALCULATORS.filter((c) => c.group === group.id).map((calc) => {
                  const selected = calc.id === activeId;
                  return (
                    <Pressable
                      key={calc.id}
                      onPress={() => setActiveId(calc.id)}
                      accessibilityRole="tab"
                      accessibilityLabel={calc.accessibilityLabel}
                      accessibilityState={{ selected }}
                      testID={`calc-tab-${calc.id}`}
                      style={[styles.sidebarItem, selected && styles.sidebarItemSelected]}
                    >
                      <Text
                        style={[styles.sidebarItemText, selected && styles.sidebarItemTextSelected]}
                      >
                        {calc.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.mobileNav}>
            <View
              style={styles.filterRow}
              accessibilityRole="radiogroup"
              accessibilityLabel="Filter calculators by category"
            >
              {(
                [
                  { id: "all" as const, label: "All (18)" },
                  ...GROUPS.map((g) => ({ id: g.id, label: g.shortLabel })),
                ] as const
              ).map((chip) => {
                const selected = groupFilter === chip.id;
                return (
                  <Pressable
                    key={chip.id}
                    onPress={() => setGroupFilter(chip.id)}
                    accessibilityRole="radio"
                    accessibilityLabel={`Show ${chip.label} calculators`}
                    accessibilityState={{ checked: selected }}
                    style={[styles.filterChip, selected && styles.filterChipSelected]}
                  >
                    <Text
                      style={[styles.filterChipText, selected && styles.filterChipTextSelected]}
                    >
                      {chip.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View
              style={styles.pillGrid}
              accessibilityRole="tablist"
              accessibilityLabel="Calculator selector"
            >
              {visibleOnMobile.map((calc) => {
                const selected = calc.id === activeId;
                return (
                  <Pressable
                    key={calc.id}
                    onPress={() => setActiveId(calc.id)}
                    accessibilityRole="tab"
                    accessibilityLabel={calc.accessibilityLabel}
                    accessibilityState={{ selected }}
                    testID={`calc-tab-${calc.id}`}
                    style={[styles.pillItem, selected && styles.pillItemSelected]}
                  >
                    <Text style={[styles.pillItemText, selected && styles.pillItemTextSelected]}>
                      {calc.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        <View style={isDesktop ? styles.mainPane : undefined}>
          <ActiveCalculator />
        </View>
      </View>
    </AppShell>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    workspace: {
      gap: spacing.lg,
    },
    workspaceDesktop: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.lg,
    },
    sidebar: {
      width: 224,
      backgroundColor: colors.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.md,
    },
    sidebarGroup: {
      gap: 3,
    },
    groupHeading: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      paddingHorizontal: spacing.sm,
      paddingBottom: 4,
    },
    sidebarItem: {
      minHeight: 36,
      paddingHorizontal: spacing.sm,
      paddingVertical: 7,
      borderRadius: radii.sm,
      justifyContent: "center",
    },
    sidebarItemSelected: {
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    sidebarItemText: {
      fontSize: 14,
      fontWeight: "500",
      color: colors.text,
    },
    sidebarItemTextSelected: {
      color: colors.accentPressed,
      fontWeight: "700",
    },
    mobileNav: {
      gap: spacing.sm,
    },
    filterRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    filterChip: {
      minHeight: 34,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radii.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      justifyContent: "center",
    },
    filterChipSelected: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    filterChipText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.textMuted,
    },
    filterChipTextSelected: {
      color: colors.accentText,
    },
    pillGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      backgroundColor: colors.surfaceSubtle,
      padding: spacing.sm,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    pillItem: {
      minHeight: 36,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: radii.sm,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      justifyContent: "center",
    },
    pillItemSelected: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    pillItemText: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.text,
    },
    pillItemTextSelected: {
      color: colors.accentPressed,
      fontWeight: "700",
    },
    mainPane: {
      flex: 1,
    },
  });
