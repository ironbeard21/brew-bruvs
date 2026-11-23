// SPDX-License-Identifier: AGPL-3.0-or-later
import { units } from "@brew-bruvs/brew-math";
import { useEffect } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { CatalogStyle } from "../../api/catalog";
import type { RecipeDetail, RecipeFileFormat, RecipeVersion } from "../../api/recipes";
import { useUnits } from "../../state/units";
import { colors, radii, spacing } from "../../theme";
import { formatMass, formatTemperature, formatVolume } from "../batches/batchFlows";
import { Banner, Button, Card } from "../ui";
import { computeLiveRecipeStats, draftFromVersion } from "./liveStats";

export interface BrewSheetViewProps {
  recipe: RecipeDetail;
  version: RecipeVersion;
  style?: CatalogStyle | null;
  onBack: () => void;
  onExport: (format: RecipeFileFormat) => Promise<void>;
  exporting?: boolean;
  exportNotice?: string | null;
  exportError?: string | null;
}

const PRINT_STYLE_ID = "brewbruvs-brew-sheet-print-css";

const PRINT_CSS = `
@media print {
  #app-shell-header,
  #brew-sheet-toolbar {
    display: none !important;
  }
  html, body, #root, #root > div, #root > div > div {
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    background: #ffffff !important;
  }
  @page {
    margin: 0.5in;
  }
}
`;

function withStableKeys<T>(
  items: readonly T[],
  baseKey: (item: T) => string,
): { key: string; item: T }[] {
  const counts = new Map<string, number>();
  return items.map((item) => {
    const base = baseKey(item);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    return { key: seen === 0 ? base : `${base}#${seen}`, item };
  });
}

export function BrewSheetView({
  recipe,
  version,
  style = null,
  onBack,
  onExport,
  exporting = false,
  exportNotice = null,
  exportError = null,
}: BrewSheetViewProps) {
  const { unitSystem } = useUnits();

  // Inject clean @media print stylesheet on web while BrewSheetView is mounted
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    if (document.getElementById(PRINT_STYLE_ID)) return;
    const styleEl = document.createElement("style");
    styleEl.id = PRINT_STYLE_ID;
    styleEl.textContent = PRINT_CSS;
    document.head.appendChild(styleEl);
    return () => {
      styleEl.remove();
    };
  }, []);

  const computed =
    version.stats ??
    computeLiveRecipeStats(draftFromVersion(version, unitSystem), unitSystem, style, null).stats;

  const { content } = version;

  const handlePrint = () => {
    if (
      Platform.OS === "web" &&
      typeof window !== "undefined" &&
      typeof window.print === "function"
    ) {
      window.print();
    }
  };

  return (
    <View style={styles.root}>
      {/* On-screen toolbar (hidden in @media print) */}
      <View nativeID="brew-sheet-toolbar" style={styles.toolbar} testID="brew-sheet-toolbar">
        <Button label="Back to recipe" variant="secondary" onPress={onBack} />
        {Platform.OS === "web" ? (
          <Button label="Print brew sheet" onPress={handlePrint} testID="print-brew-sheet-button" />
        ) : null}
        <Button
          label={exporting ? "Exporting..." : "Export BeerXML"}
          variant="secondary"
          disabled={exporting}
          onPress={() => void onExport("beerxml")}
          testID="brew-sheet-export-beerxml"
        />
        <Button
          label={exporting ? "Exporting..." : "Export BeerJSON"}
          variant="secondary"
          disabled={exporting}
          onPress={() => void onExport("beerjson")}
          testID="brew-sheet-export-beerjson"
        />
      </View>

      {exportNotice ? <Banner tone="success" message={exportNotice} /> : null}
      {exportError ? <Banner tone="error" message={exportError} /> : null}

      {/* Printable Brew Sheet Document */}
      <Card style={styles.sheet}>
        <View style={styles.sheetBody} testID="brew-sheet-document">
          <View style={styles.docHeader}>
            <View style={styles.docTitleCol}>
              <Text style={styles.docTitle} testID="brew-sheet-title">
                {version.name}
              </Text>
              <Text style={styles.docSubtitle}>
                {version.beverage.toUpperCase()} · Version v{version.version}
                {style ? ` · ${style.styleId ? `${style.styleId} ` : ""}${style.name}` : ""}
              </Text>
            </View>
            <View style={styles.metaGrid}>
              <Text style={styles.metaItem}>
                Batch: {formatVolume(version.batchSizeL, unitSystem)}
              </Text>
              {content.boilTimeMin != null ? (
                <Text style={styles.metaItem}>Boil: {content.boilTimeMin} min</Text>
              ) : null}
              {content.efficiencyPct != null ? (
                <Text style={styles.metaItem}>Efficiency: {content.efficiencyPct}%</Text>
              ) : null}
            </View>
          </View>

          {/* Computed target stats */}
          {computed ? (
            <View style={styles.statsBar} testID="brew-sheet-stats">
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Est. OG</Text>
                <Text style={styles.statValue}>{computed.og.toFixed(3)}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Est. FG</Text>
                <Text style={styles.statValue}>{computed.fg.toFixed(3)}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Est. ABV</Text>
                <Text style={styles.statValue}>{computed.abvPct.toFixed(2)}%</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>IBU</Text>
                <Text style={styles.statValue}>{Math.round(computed.ibu)}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Color</Text>
                <Text style={styles.statValue}>
                  {unitSystem === "us"
                    ? `${computed.colorSrm.toFixed(1)} SRM`
                    : `${computed.colorEbc.toFixed(1)} EBC`}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Permanent Credit / Attribution */}
          {recipe.credit || recipe.forkedFrom ? (
            <View style={styles.creditBar} testID="brew-sheet-credit">
              <Text style={styles.creditText}>
                Attribution:{" "}
                {[
                  recipe.credit?.author ? `Author: ${recipe.credit.author}` : null,
                  recipe.credit?.site ? `Site: ${recipe.credit.site}` : null,
                  recipe.credit?.sourceUrl ? `Source: ${recipe.credit.sourceUrl}` : null,
                  recipe.credit?.license ? `License: ${recipe.credit.license}` : null,
                  recipe.forkedFrom ? `Forked from: ${recipe.forkedFrom.uri}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
          ) : null}

          {/* Fermentables */}
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Fermentables ({content.fermentables.length})</Text>
            {content.fermentables.length === 0 ? (
              <Text style={styles.muted}>None listed.</Text>
            ) : (
              withStableKeys(
                content.fermentables,
                (f) => `ferm-${f.name}-${f.kind}-${f.amountKg ?? f.amountL ?? 0}`,
              ).map(({ key, item: f }) => {
                const amt =
                  f.amountKg != null
                    ? formatMass(f.amountKg, unitSystem)
                    : f.amountL != null
                      ? formatVolume(f.amountL, unitSystem)
                      : "—";
                const colorText =
                  f.colorEbc != null
                    ? unitSystem === "us"
                      ? `${units.srmToLovibond(units.ebcToSrm(f.colorEbc)).toFixed(1)} °L`
                      : `${f.colorEbc.toFixed(1)} EBC`
                    : null;
                return (
                  <View key={key} style={styles.row}>
                    <Text style={styles.rowPrimary}>{f.name}</Text>
                    <Text style={styles.rowSecondary}>
                      {[amt, f.kind, f.use, colorText].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                );
              })
            )}
          </View>

          {/* Hops */}
          {content.hops.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Hops ({content.hops.length})</Text>
              {withStableKeys(
                content.hops,
                (h) => `hop-${h.name}-${h.use}-${h.timeMin ?? h.days ?? 0}-${h.amountKg}`,
              ).map(({ key, item: h }) => {
                const timing =
                  h.use === "dry_hop"
                    ? h.days != null
                      ? `${h.days} days`
                      : "dry hop"
                    : h.timeMin != null
                      ? `${h.timeMin} min`
                      : h.use;
                const temp = h.tempC != null ? formatTemperature(h.tempC, unitSystem) : null;
                return (
                  <View key={key} style={styles.row}>
                    <Text style={styles.rowPrimary}>{h.name}</Text>
                    <Text style={styles.rowSecondary}>
                      {[
                        formatMass(h.amountKg, unitSystem),
                        h.alphaAcidPct != null ? `${h.alphaAcidPct}% AA` : null,
                        h.use.replace("_", " "),
                        timing,
                        temp,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* Yeasts */}
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Yeast ({content.yeasts.length})</Text>
            {content.yeasts.length === 0 ? (
              <Text style={styles.muted}>None listed.</Text>
            ) : (
              withStableKeys(content.yeasts, (y) => `yeast-${y.name}-${y.form ?? "dry"}`).map(
                ({ key, item: y }) => (
                  <View key={key} style={styles.row}>
                    <Text style={styles.rowPrimary}>{y.name}</Text>
                    <Text style={styles.rowSecondary}>
                      {[
                        y.form,
                        y.packs != null ? `${y.packs} pack${y.packs === 1 ? "" : "s"}` : null,
                        y.attenuationPct != null ? `${y.attenuationPct}% atten.` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                ),
              )
            )}
          </View>

          {/* Miscs / Additions */}
          {content.miscs.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Additions & Miscs ({content.miscs.length})</Text>
              {withStableKeys(content.miscs, (m) => `misc-${m.name}-${m.kind}-${m.use}`).map(
                ({ key, item: m }) => {
                  const amt =
                    m.amountKg != null
                      ? formatMass(m.amountKg, unitSystem)
                      : m.amountL != null
                        ? formatVolume(m.amountL, unitSystem)
                        : m.count != null
                          ? `${m.count}x`
                          : "";
                  return (
                    <View key={key} style={styles.row}>
                      <Text style={styles.rowPrimary}>{m.name}</Text>
                      <Text style={styles.rowSecondary}>
                        {[
                          amt,
                          m.kind,
                          m.use.replace("_", " "),
                          m.timeMin != null ? `${m.timeMin} min` : null,
                          m.dayOffset != null ? `Day ${m.dayOffset}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                  );
                },
              )}
            </View>
          ) : null}

          {/* Mash Schedule */}
          {content.mash.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Mash Schedule</Text>
              {withStableKeys(
                content.mash,
                (step) => `mash-${step.name}-${step.tempC}-${step.timeMin}`,
              ).map(({ key, item: step }, idx) => (
                <View key={key} style={styles.row}>
                  <Text style={styles.rowPrimary}>
                    {idx + 1}. {step.name} ({step.type})
                  </Text>
                  <Text style={styles.rowSecondary}>
                    {[
                      formatTemperature(step.tempC, unitSystem),
                      `${step.timeMin} min`,
                      step.infuseL != null
                        ? `Infuse ${formatVolume(step.infuseL, unitSystem)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Fermentation Schedule */}
          {content.fermentation.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Fermentation & Aging</Text>
              {withStableKeys(
                content.fermentation,
                (step) => `fermstep-${step.name}-${step.stage}-${step.days ?? 0}`,
              ).map(({ key, item: step }) => (
                <View key={key} style={styles.row}>
                  <Text style={styles.rowPrimary}>
                    {step.name} ({step.stage.replace("_", " ")})
                  </Text>
                  <Text style={styles.rowSecondary}>
                    {[
                      step.tempC != null ? formatTemperature(step.tempC, unitSystem) : null,
                      step.days != null ? `${step.days} days` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Notes */}
          {content.notes ? (
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Recipe Notes</Text>
              <Text style={styles.notesText}>{content.notes}</Text>
            </View>
          ) : null}

          {/* Pen-and-Paper Brew-Day Log */}
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Brew-Day Log</Text>
            <View style={styles.logGrid}>
              {[
                "Brew Date",
                "Mash Temp",
                "Pre-Boil Gravity",
                "Pre-Boil Volume",
                "Original Gravity (OG)",
                "Volume into Fermenter",
                "Pitch Temp",
                "Final Gravity (FG)",
              ].map((field) => (
                <View key={field} style={styles.logCell}>
                  <Text style={styles.logLabel}>{field}</Text>
                  <View style={styles.logBlankLine} />
                </View>
              ))}
            </View>
          </View>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  sheet: {
    backgroundColor: colors.surface,
  },
  sheetBody: {
    gap: spacing.lg,
  },
  docHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.text,
  },
  docTitleCol: { flex: 1, minWidth: 200, gap: 4 },
  docTitle: { fontSize: 24, fontWeight: "800", color: colors.text },
  docSubtitle: { fontSize: 14, fontWeight: "600", color: colors.textMuted },
  metaGrid: { alignItems: "flex-end", gap: 2 },
  metaItem: { fontSize: 13, fontWeight: "700", color: colors.text },
  statsBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  statBox: {
    flex: 1,
    minWidth: 96,
    padding: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    gap: 2,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  statValue: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  creditBar: {
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  creditText: { fontSize: 12, color: colors.textMuted },
  section: { gap: spacing.xs },
  sectionHeading: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.text,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowPrimary: { fontSize: 14, fontWeight: "600", color: colors.text },
  rowSecondary: {
    fontSize: 13,
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
  },
  muted: { fontSize: 13, color: colors.textMuted },
  notesText: { fontSize: 14, lineHeight: 20, color: colors.text },
  logGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  logCell: {
    width: "46%",
    minWidth: 150,
    gap: 8,
  },
  logLabel: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  logBlankLine: {
    height: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
  },
});
