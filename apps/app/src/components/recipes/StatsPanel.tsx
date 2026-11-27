// SPDX-License-Identifier: AGPL-3.0-or-later
import { type Fit, units } from "@brew-bruvs/brew-math";
import { StyleSheet, Text, View } from "react-native";
import type { CatalogStyle } from "../../api/catalog";
import { useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { radii, spacing, type ThemeColors } from "../../theme";
import { formatFixed } from "../calculators/parseNumber";
import { Banner, Card } from "../ui";
import type { LiveStatsResult } from "./liveStats";

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

function srmHex(srm: number): string {
  if (srm <= 0) return "#FFF8E1";
  const idx = Math.max(0, Math.min(SRM_HEX_STOPS.length - 1, Math.round(srm) - 1));
  return SRM_HEX_STOPS[idx] ?? "#36080A";
}

function fitLabel(fit: Fit | undefined): string {
  if (fit === "inside") return "Inside";
  if (fit === "below") return "Below";
  if (fit === "above") return "Above";
  return "";
}

function formatRange(
  min: number | null | undefined,
  max: number | null | undefined,
  fmt: (v: number) => string,
  unit = "",
): string | null {
  const suffix = unit ? ` ${unit}` : "";
  if (min != null && max != null) return `${fmt(min)}–${fmt(max)}${suffix}`;
  if (min != null) return `≥ ${fmt(min)}${suffix}`;
  if (max != null) return `≤ ${fmt(max)}${suffix}`;
  return null;
}

interface StatMeterProps {
  label: string;
  value: string;
  range: string | null;
  fit: Fit | undefined;
  testID: string;
  fitTestID: string;
}

function StatMeter({ label, value, range, fit, testID, fitTestID }: StatMeterProps) {
  const styles = useThemedStyles(createStyles);
  const badgeText = fitLabel(fit);
  return (
    <View
      style={styles.statRow}
      accessible
      accessibilityLabel={`${label}: ${value}${range ? `, style range ${range}` : ""}${badgeText ? `, ${badgeText}` : ""}`}
    >
      <View style={styles.statLeft}>
        <Text style={styles.statLabel}>{label}</Text>
        {range ? <Text style={styles.statRange}>Style: {range}</Text> : null}
      </View>
      <View style={styles.statRight}>
        <Text style={styles.statValue} testID={testID}>
          {value}
        </Text>
        {badgeText ? (
          <View
            testID={fitTestID}
            style={[
              styles.fitBadge,
              fit === "inside" && styles.fitInside,
              fit === "below" && styles.fitWarn,
              fit === "above" && styles.fitWarn,
            ]}
          >
            <Text
              style={[
                styles.fitBadgeText,
                fit === "inside" && styles.fitInsideText,
                fit !== "inside" && styles.fitWarnText,
              ]}
            >
              {badgeText}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export interface StatsPanelProps {
  live: LiveStatsResult;
  style: CatalogStyle | null;
}

export function StatsPanel({ live, style }: StatsPanelProps) {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();

  const colorRange =
    style == null
      ? null
      : unitSystem === "us"
        ? formatRange(
            style.colorEbcMin != null ? units.ebcToSrm(style.colorEbcMin) : null,
            style.colorEbcMax != null ? units.ebcToSrm(style.colorEbcMax) : null,
            (v) => formatFixed(v, 1),
            "SRM",
          )
        : formatRange(style.colorEbcMin, style.colorEbcMax, (v) => formatFixed(v, 1), "EBC");

  return (
    <Card>
      <View style={styles.header}>
        <Text style={styles.title}>Live Recipe Stats</Text>
        {style ? (
          <Text style={styles.styleSubtitle} testID="stats-style-name">
            {style.styleId} · {style.name} ({style.styleGuide})
          </Text>
        ) : (
          <Text style={styles.styleSubtitle}>Pick a style to compare target ranges</Text>
        )}
      </View>

      {live.error ? (
        <Banner tone="info" message={live.error} testID="recipe-stats-message" />
      ) : live.stats ? (
        <View style={styles.list}>
          <View
            style={[styles.swatch, { backgroundColor: srmHex(live.stats.colorSrm) }]}
            accessible
            accessibilityLabel={`Estimated recipe color swatch (${formatFixed(live.stats.colorSrm, 1)} SRM)`}
            testID="recipe-color-swatch"
          />
          <StatMeter
            label="Original Gravity (OG)"
            value={formatFixed(live.stats.og, 3)}
            range={formatRange(style?.ogMin, style?.ogMax, (v) => formatFixed(v, 3))}
            fit={live.fit?.og}
            testID="stat-og"
            fitTestID="fit-og"
          />
          <StatMeter
            label="Final Gravity (FG)"
            value={formatFixed(live.stats.fg, 3)}
            range={formatRange(style?.fgMin, style?.fgMax, (v) => formatFixed(v, 3))}
            fit={live.fit?.fg}
            testID="stat-fg"
            fitTestID="fit-fg"
          />
          <StatMeter
            label="ABV"
            value={`${formatFixed(live.stats.abvPct, 1)}%`}
            range={formatRange(style?.abvMinPct, style?.abvMaxPct, (v) => formatFixed(v, 1), "%")}
            fit={live.fit?.abvPct}
            testID="stat-abv"
            fitTestID="fit-abv"
          />
          <StatMeter
            label="Bitterness (IBU)"
            value={`${formatFixed(live.stats.ibu, 0)} IBU`}
            range={formatRange(style?.ibuMin, style?.ibuMax, (v) => formatFixed(v, 0), "IBU")}
            fit={live.fit?.ibu}
            testID="stat-ibu"
            fitTestID="fit-ibu"
          />
          <StatMeter
            label="Color"
            value={
              unitSystem === "us"
                ? `${formatFixed(live.stats.colorSrm, 1)} SRM`
                : `${formatFixed(live.stats.colorEbc, 1)} EBC`
            }
            range={colorRange}
            fit={live.fit?.colorEbc}
            testID="stat-color"
            fitTestID="fit-color"
          />
        </View>
      ) : null}
    </Card>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    header: { gap: 2 },
    title: { fontSize: 18, fontWeight: "700", color: colors.text },
    styleSubtitle: { fontSize: 13, color: colors.textMuted },
    list: { gap: spacing.sm },
    swatch: {
      height: 28,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    statRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceSubtle,
      gap: spacing.sm,
    },
    statLeft: { flex: 1, gap: 2 },
    statLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
    statRange: { fontSize: 12, color: colors.textMuted },
    statRight: { alignItems: "flex-end", gap: 4 },
    statValue: {
      fontSize: 17,
      fontWeight: "700",
      color: colors.text,
      fontVariant: ["tabular-nums"],
    },
    fitBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radii.pill,
    },
    fitInside: {
      backgroundColor: colors.successSoft,
    },
    fitWarn: {
      backgroundColor: colors.accentSoft,
    },
    fitBadgeText: {
      fontSize: 11,
      fontWeight: "700",
    },
    fitInsideText: {
      color: colors.success,
    },
    fitWarnText: {
      color: colors.accentPressed,
    },
  });
