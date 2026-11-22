// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { type CatalogItem, type CatalogKind, useCatalogSearch } from "../../api/catalog";
import { colors, radii, spacing } from "../../theme";
import { formatFixed } from "../calculators/parseNumber";
import { Banner, Button, TextField } from "../ui";

function summarizeItem(item: CatalogItem): string {
  const parts: string[] = [];
  if (item.aliases.length > 0) {
    parts.push(`aka ${item.aliases.slice(0, 3).join(", ")}`);
  }
  switch (item.catalog) {
    case "fermentables":
      if (item.potentialSg != null) parts.push(`${formatFixed(item.potentialSg, 3)} SG`);
      if (item.colorEbc != null) parts.push(`${formatFixed(item.colorEbc, 1)} EBC`);
      break;
    case "hops":
      if (item.alphaAcidPct != null) parts.push(`${formatFixed(item.alphaAcidPct, 1)}% AA`);
      if (item.origin) parts.push(item.origin);
      break;
    case "yeasts":
      if (item.productId) parts.push(item.productId);
      if (item.attenuationMinPct != null) {
        parts.push(
          item.attenuationMaxPct != null && item.attenuationMaxPct !== item.attenuationMinPct
            ? `${item.attenuationMinPct}–${item.attenuationMaxPct}% att.`
            : `${item.attenuationMinPct}% att.`,
        );
      }
      break;
    case "styles":
      parts.push(`${item.styleId} · ${item.styleGuide}`);
      break;
    case "miscs":
      if (item.miscType) parts.push(item.miscType);
      break;
    default:
      break;
  }
  return parts.join(" · ");
}

export interface CatalogPickerProps {
  serverUrl: string | null;
  authToken: string | null;
  catalog: CatalogKind;
  label: string;
  placeholder: string;
  onSelect: (item: CatalogItem) => void;
  onAddCustom?: (name: string) => void;
  testIDPrefix: string;
  customFetch?: typeof fetch;
}

export function CatalogPicker({
  serverUrl,
  authToken,
  catalog,
  label,
  placeholder,
  onSelect,
  onAddCustom,
  testIDPrefix,
  customFetch,
}: CatalogPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const search = useCatalogSearch(
    serverUrl,
    authToken,
    catalog,
    query,
    open || query.trim().length > 0,
    customFetch,
  );

  const items = search.data ?? [];

  return (
    <View style={styles.wrapper}>
      <View style={styles.searchRow}>
        <View style={styles.inputFlex}>
          <TextField
            label={label}
            value={query}
            onChangeText={(next) => {
              setQuery(next);
              setOpen(true);
            }}
            placeholder={placeholder}
            testID={`${testIDPrefix}-search-input`}
          />
        </View>
        {onAddCustom ? (
          <View style={styles.customBtnWrap}>
            <Button
              label="Add custom"
              variant="secondary"
              onPress={() => {
                onAddCustom(query.trim());
                setQuery("");
                setOpen(false);
              }}
              accessibilityLabel={`Add custom free-text ${catalog} line`}
              testID={`${testIDPrefix}-add-custom`}
            />
          </View>
        ) : null}
      </View>

      {open && query.trim().length > 0 ? (
        <View style={styles.resultsBox} testID={`${testIDPrefix}-results`}>
          {search.isPending ? (
            <Text style={styles.statusText}>Searching catalog...</Text>
          ) : search.isError ? (
            <Banner
              tone="error"
              message={
                search.error instanceof Error ? search.error.message : "Catalog search failed."
              }
            />
          ) : items.length === 0 ? (
            <Text style={styles.statusText}>
              No catalog matches for &quot;{query.trim()}&quot;.
              {onAddCustom ? " Use Add custom to enter a free-text line." : ""}
            </Text>
          ) : (
            items.slice(0, 12).map((item) => {
              const summary = summarizeItem(item);
              return (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    onSelect(item);
                    setQuery("");
                    setOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${item.name}${summary ? `, ${summary}` : ""}`}
                  testID={`${testIDPrefix}-option-${item.id}`}
                  style={styles.optionRow}
                >
                  <Text style={styles.optionName}>{item.name}</Text>
                  {summary ? <Text style={styles.optionMeta}>{summary}</Text> : null}
                </Pressable>
              );
            })
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  searchRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, flexWrap: "wrap" },
  inputFlex: { flex: 1, minWidth: 180 },
  customBtnWrap: { paddingBottom: 0 },
  resultsBox: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  statusText: {
    padding: spacing.md,
    fontSize: 13,
    color: colors.textMuted,
  },
  optionRow: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    justifyContent: "center",
    gap: 2,
  },
  optionName: { fontSize: 14, fontWeight: "600", color: colors.text },
  optionMeta: { fontSize: 12, color: colors.textMuted },
});
