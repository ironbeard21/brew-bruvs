// SPDX-License-Identifier: AGPL-3.0-or-later
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { CatalogAttribution, CatalogSource } from "../../api/catalog";
import { colors, radii, spacing } from "../../theme";
import { Banner, Card } from "../ui";

export const SOURCE_CODE_URL = "https://github.com/ironbeard21/brew-bruvs";
export const AGPL_LICENSE_URL = "https://www.gnu.org/licenses/agpl-3.0.en.html";

/**
 * Fallback catalog sources matching packages/catalog-seed/ATTRIBUTION.md when viewed offline
 * or before signing in (live server attribution from GET /api/catalog/sources is preferred when signed in).
 */
export const BUNDLED_CATALOG_SOURCES: readonly {
  id: string;
  name: string;
  license: string;
  url: string;
  commit: string | null;
}[] = [
  {
    id: "brewtarget",
    name: "Brewtarget default content (hops, yeasts, fermentables, misc, styles, water, equipment)",
    license: "GPL-3.0",
    url: "https://github.com/Brewtarget/brewtarget",
    commit: null,
  },
  {
    id: "beer-analytics",
    name: "beer-analytics.com content (via Brewtarget DefaultContent005)",
    license: "CC BY-SA 4.0",
    url: "https://www.beer-analytics.com/",
    commit: null,
  },
  {
    id: "the-swaen",
    name: "The Swaen malthouse specifications (via Brewtarget)",
    license: "GPL-3.0 (via Brewtarget)",
    url: "https://theswaen.com/",
    commit: null,
  },
  {
    id: "canadian-homebrewers",
    name: "Canadian Homebrewers Association items (via Brewtarget)",
    license: "GPL-3.0 (via Brewtarget)",
    url: "https://canadahomebrews.ca/recipes/",
    commit: null,
  },
  {
    id: "dotbeer",
    name: "DotBeer example library (via Brewtarget)",
    license: "GPL-3.0 (via Brewtarget)",
    url: "https://github.com/Brewken/DotBeer",
    commit: null,
  },
  {
    id: "wallbrew",
    name: "Wall Brew Co common-beer-data",
    license: "MIT, Copyright (c) 2022-2026 Wall Brew Co.",
    url: "https://github.com/Wall-Brew-Co/common-beer-data",
    commit: null,
  },
  {
    id: "beerproto",
    name: "BeerProto dataset",
    license: "MIT, Copyright (c) 2020 BeerProto",
    url: "https://github.com/beerproto/dataset",
    commit: null,
  },
  {
    id: "bjcpjson",
    name: "BeerJSON bjcp-json (numeric style ranges only)",
    license: "MIT, Copyright (c) 2022 BeerJSON",
    url: "https://github.com/beerjson/bjcp-json",
    commit: null,
  },
  {
    id: "brew-bruvs-starter",
    name: "Brew-Bruvs starter set",
    license: "CC0-1.0",
    url: SOURCE_CODE_URL,
    commit: null,
  },
];

export interface AboutPanelProps {
  sourceUrl?: string | undefined;
  attribution?: CatalogAttribution | null;
  loading?: boolean;
  error?: string | null;
}

function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

export function AboutPanel({
  sourceUrl,
  attribution = null,
  loading = false,
  error = null,
}: AboutPanelProps) {
  const sourceCodeUrl = sourceUrl && isHttpUrl(sourceUrl) ? sourceUrl : SOURCE_CODE_URL;
  const sourceRows: { id: string; source: CatalogSource }[] = attribution
    ? Object.entries(attribution.sources).map(([id, source]) => ({ id, source }))
    : BUNDLED_CATALOG_SOURCES.map((s) => ({
        id: s.id,
        source: { name: s.name, url: s.url, license: s.license, commit: s.commit },
      }));

  return (
    <View style={styles.root} testID="about-panel">
      {/* License & Source Code */}
      <Card>
        <Text style={styles.sectionTitle}>Brew-Bruvs</Text>
        <Text style={styles.body}>
          Brew-Bruvs is free, self-hosted software for making beer, mead, wine, and cider —
          including brewing calculators, recipe design, batch tracking, and brew-day timers.
        </Text>

        <View style={styles.licenseBox} testID="about-license-box">
          <Text style={styles.licenseHeading}>License: GNU AGPL-3.0-or-later</Text>
          <Text style={styles.body}>
            This program is free software licensed under the GNU Affero General Public License v3.0
            or later (SPDX: AGPL-3.0-or-later). You have the freedom to run, study, share, and
            modify this software, and users interacting with a modified server over a network are
            entitled to its corresponding source code.
          </Text>
          <View style={styles.linkRow}>
            <Pressable
              onPress={() => void Linking.openURL(sourceCodeUrl)}
              accessibilityRole="link"
              accessibilityLabel="View Brew-Bruvs source code repository"
              testID="about-source-code-link"
            >
              <Text style={styles.link}>Source code: {sourceCodeUrl}</Text>
            </Pressable>
            <Pressable
              onPress={() => void Linking.openURL(AGPL_LICENSE_URL)}
              accessibilityRole="link"
              accessibilityLabel="Read GNU AGPL-3.0 license"
              testID="about-license-link"
            >
              <Text style={styles.link}>Read GNU AGPL-3.0 license</Text>
            </Pressable>
          </View>
        </View>
      </Card>

      {/* Catalog Sources & Licenses */}
      <Card>
        <Text style={styles.sectionTitle}>Catalog Data Sources & Licenses</Text>
        <Text style={styles.muted}>
          {attribution
            ? "Loaded live from your connected Brew-Bruvs server (/api/catalog/sources)."
            : "Showing bundled catalog attribution. Sign in to a server to inspect its live catalog source commits."}
        </Text>

        {loading ? (
          <Banner tone="info" message="Loading catalog attribution from server..." />
        ) : null}
        {error ? <Banner tone="info" message={`Showing bundled attribution (${error}).`} /> : null}

        <View style={styles.sourceList} testID="about-catalog-sources">
          {sourceRows.map(({ id, source }) => (
            <View key={id} style={styles.sourceRow} testID={`catalog-source-${id}`}>
              <View style={styles.sourceHeader}>
                <Text style={styles.sourceName}>{source.name}</Text>
                <View style={styles.licenseBadge}>
                  <Text style={styles.licenseBadgeText}>{source.license}</Text>
                </View>
              </View>
              <View style={styles.sourceMeta}>
                <Text style={styles.sourceId}>ID: {id}</Text>
                {source.commit ? (
                  <Text style={styles.sourceCommit}>Commit: {source.commit.slice(0, 12)}</Text>
                ) : null}
              </View>
              {isHttpUrl(source.url) ? (
                <Pressable
                  onPress={() => void Linking.openURL(source.url)}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${source.name} source link`}
                >
                  <Text style={styles.link}>{source.url}</Text>
                </Pressable>
              ) : (
                <Text style={styles.muted}>{source.url}</Text>
              )}
            </View>
          ))}
        </View>

        <View style={styles.guidelinesNote}>
          <Text style={styles.muted}>
            Style names and numeric ranges originate from the BJCP Style Guidelines (bjcp.org) and
            the Brewers Association Beer Style Guidelines (brewersassociation.org). Descriptive
            style text is not included.
          </Text>
        </View>

        {attribution?.attribution ? (
          <View style={styles.rawAttributionBox} testID="about-attribution-markdown">
            <Text style={styles.rawHeading}>Server Attribution Notice (ATTRIBUTION.md)</Text>
            <Text style={styles.rawText}>{attribution.attribution}</Text>
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  body: { fontSize: 14, lineHeight: 21, color: colors.text },
  muted: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  licenseBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    gap: spacing.sm,
  },
  licenseHeading: { fontSize: 15, fontWeight: "800", color: colors.accentPressed },
  linkRow: { gap: 6 },
  link: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.accent,
    textDecorationLine: "underline",
  },
  sourceList: { gap: spacing.sm },
  sourceRow: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  sourceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  sourceName: { fontSize: 14, fontWeight: "700", color: colors.text, flex: 1, minWidth: 180 },
  licenseBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  licenseBadgeText: { fontSize: 12, fontWeight: "700", color: colors.accentPressed },
  sourceMeta: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  sourceId: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  sourceCommit: {
    fontSize: 12,
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
  },
  guidelinesNote: {
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rawAttributionBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  rawHeading: { fontSize: 13, fontWeight: "700", color: colors.text },
  rawText: { fontSize: 12, lineHeight: 18, color: colors.textMuted },
});
