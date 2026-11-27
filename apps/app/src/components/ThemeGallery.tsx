// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useTheme, useThemedStyles } from "../state/theme";
import {
  DESKTOP_BREAKPOINT,
  radii,
  spacing,
  THEME_CATEGORY_LABELS,
  THEMES,
  type ThemeCategory,
  type ThemeColors,
  type ThemeDefinition,
  type ThemeMode,
} from "../theme";
import { Button, SegmentedControl, type SegmentedOption } from "./ui";

type CategoryFilter = "all" | ThemeCategory;
type ModeFilter = "all" | ThemeMode;

const countIn = (category: ThemeCategory) => THEMES.filter((t) => t.category === category).length;

const CATEGORY_OPTIONS: readonly SegmentedOption<CategoryFilter>[] = [
  { value: "all", label: `All (${THEMES.length})` },
  ...(["beer", "wine", "mead", "cider"] as const).map((category) => ({
    value: category,
    label: `${THEME_CATEGORY_LABELS[category]} (${countIn(category)})`,
  })),
];

const MODE_OPTIONS: readonly SegmentedOption<ModeFilter>[] = [
  { value: "all", label: "All" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export interface ThemeSwatchDotsProps {
  swatches: readonly [string, string, string];
  borderColor: string;
  size?: number;
}

export function ThemeSwatchDots({ swatches, borderColor, size = 12 }: ThemeSwatchDotsProps) {
  const [liquid, soft, base] = swatches;
  const slots = [
    { role: "liquid", hex: liquid, overlap: false, zIndex: 3 },
    { role: "soft", hex: soft, overlap: true, zIndex: 2 },
    { role: "base", hex: base, overlap: true, zIndex: 1 },
  ] as const;
  return (
    <View style={swatchStyles.row} accessible={false}>
      {slots.map((slot) => (
        <View
          key={slot.role}
          style={[
            swatchStyles.dot,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: slot.hex,
              borderColor,
              marginLeft: slot.overlap ? -Math.round(size * 0.25) : 0,
              zIndex: slot.zIndex,
            },
          ]}
        />
      ))}
    </View>
  );
}

const swatchStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  dot: {
    borderWidth: 1.5,
  },
});

interface ThemePreviewCardProps {
  item: ThemeDefinition;
  selected: boolean;
  compact: boolean;
  inModal: boolean;
  onSelect: () => void;
}

function ThemePreviewCard({ item, selected, compact, inModal, onSelect }: ThemePreviewCardProps) {
  const styles = useThemedStyles(createGalleryStyles);
  const c = item.colors;

  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityLabel={`${item.name} — ${THEME_CATEGORY_LABELS[item.category]}, ${item.mode} theme. ${item.tagline}`}
      accessibilityState={{ selected, checked: selected }}
      testID={`theme-card-${item.id}`}
      style={({ pressed }) => [
        styles.cardWrap,
        compact ? styles.cardWrapFull : inModal ? styles.cardWrapModal : styles.cardWrapGrid,
        {
          backgroundColor: c.surface,
          borderColor: selected ? c.accent : c.borderStrong,
          borderWidth: selected ? 2 : 1,
          shadowColor: c.shadow,
        },
        pressed && styles.cardPressed,
      ]}
    >
      {/* Top liquid accent bar */}
      <View style={[styles.cardAccentStrip, { backgroundColor: c.accent }]} />

      {/* Mini live UI preview rendered in this theme's real palette */}
      <View
        style={[styles.miniPreview, { backgroundColor: c.canvas, borderBottomColor: c.border }]}
        accessible={false}
      >
        <View style={styles.miniHeaderRow}>
          <View style={[styles.miniBrandPill, { backgroundColor: c.accent }]}>
            <View style={[styles.miniBrandDot, { backgroundColor: c.accentText }]} />
          </View>
          <View style={[styles.miniNavChip, { backgroundColor: c.accentSoft }]} />
          <View style={[styles.miniNavChipMuted, { backgroundColor: c.surfaceSubtle }]} />
          <View style={styles.miniSpacer} />
          <ThemeSwatchDots swatches={item.swatches} borderColor={c.borderStrong} size={11} />
        </View>
        <View style={[styles.miniCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.miniTextCol}>
            <View style={[styles.miniLinePrimary, { backgroundColor: c.text }]} />
            <View style={[styles.miniLineMuted, { backgroundColor: c.textMuted }]} />
          </View>
          <View style={[styles.miniButton, { backgroundColor: c.accent }]} />
          <View style={[styles.miniSecondaryDot, { backgroundColor: c.secondary }]} />
        </View>
      </View>

      {/* Theme metadata */}
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <Text style={[styles.cardName, { color: c.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          {selected ? (
            <View style={[styles.activeBadge, { backgroundColor: c.accent }]}>
              <Text style={[styles.activeBadgeText, { color: c.accentText }]}>Active</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.metaBadgeRow}>
          <View style={[styles.metaPill, { backgroundColor: c.accentSoft }]}>
            <Text style={[styles.metaPillText, { color: c.accentPressed }]}>
              {THEME_CATEGORY_LABELS[item.category]}
            </Text>
          </View>
          <View
            style={[
              styles.metaPill,
              { backgroundColor: c.surfaceSubtle, borderWidth: 1, borderColor: c.border },
            ]}
          >
            <Text style={[styles.metaPillText, { color: c.textMuted }]}>
              {item.mode === "dark" ? "Dark" : "Light"}
            </Text>
          </View>
        </View>

        <Text style={[styles.cardTagline, { color: c.textMuted }]} numberOfLines={2}>
          {item.tagline}
        </Text>
      </View>
    </Pressable>
  );
}

export interface ThemeGalleryProps {
  /** Compact mode adapts the header for rendering inside the quick switcher modal. */
  inModal?: boolean;
  onSelectTheme?: () => void;
}

export function ThemeGallery({ inModal = false, onSelectTheme }: ThemeGalleryProps) {
  const { theme, themes, setThemeId } = useTheme();
  const styles = useThemedStyles(createGalleryStyles);
  const { width } = useWindowDimensions();
  const isCompact = width < DESKTOP_BREAKPOINT;

  const [category, setCategory] = useState<CategoryFilter>("all");
  const [mode, setMode] = useState<ModeFilter>("all");

  const filtered = useMemo(
    () =>
      themes.filter(
        (item) =>
          (category === "all" || item.category === category) &&
          (mode === "all" || item.mode === mode),
      ),
    [themes, category, mode],
  );

  return (
    <View style={styles.root} testID="theme-gallery">
      {!inModal ? (
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleCol}>
            <Text style={styles.sectionTitle}>Beverage Themes</Text>
            <Text style={styles.sectionSubtitle}>
              Choose from {THEMES.length} craft beer, wine, mead, and cider themes across bright
              daytime and dark cellar palettes. Saved locally on this device and available offline.
            </Text>
          </View>
          <View style={styles.currentChip} testID="theme-current-badge">
            <ThemeSwatchDots
              swatches={theme.swatches}
              borderColor={theme.colors.borderStrong}
              size={13}
            />
            <Text style={styles.currentChipText}>
              {theme.name} · {theme.mode === "dark" ? "Dark" : "Light"}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.filterBar}>
        <View style={styles.filterPrimary}>
          <SegmentedControl
            options={CATEGORY_OPTIONS}
            value={category}
            onChange={setCategory}
            accessibilityLabel="Filter themes by beverage category"
          />
        </View>
        <View style={styles.filterSecondary}>
          <SegmentedControl
            options={MODE_OPTIONS}
            value={mode}
            onChange={setMode}
            accessibilityLabel="Filter themes by light or dark mode"
            compact
          />
        </View>
      </View>

      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="UI Themes">
        {filtered.map((item) => (
          <ThemePreviewCard
            key={item.id}
            item={item}
            selected={item.id === theme.id}
            compact={isCompact}
            inModal={inModal}
            onSelect={() => {
              setThemeId(item.id);
              onSelectTheme?.();
            }}
          />
        ))}
      </View>
    </View>
  );
}

export function ThemeSwitcherButton() {
  const { theme } = useTheme();
  const styles = useThemedStyles(createSwitcherStyles);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Change theme (current: ${theme.name}, ${theme.mode})`}
        testID="header-theme-button"
        style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
      >
        <ThemeSwatchDots
          swatches={theme.swatches}
          borderColor={theme.colors.borderStrong}
          size={12}
        />
        <Text style={styles.triggerText} numberOfLines={1}>
          Theme
        </Text>
      </Pressable>

      {open ? (
        <Modal
          visible={open}
          transparent
          animationType="none"
          onRequestClose={() => setOpen(false)}
        >
          <View style={styles.backdrop}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setOpen(false)}
              accessibilityLabel="Close theme picker backdrop"
            />
            <View style={styles.modalCard} testID="theme-picker-modal">
              <View style={styles.modalHeader}>
                <View style={styles.modalTitleCol}>
                  <Text accessibilityRole="header" style={styles.modalTitle}>
                    Craft Beverage Themes
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    Active: {theme.name} ({THEME_CATEGORY_LABELS[theme.category]} ·{" "}
                    {theme.mode === "dark" ? "Dark" : "Light"})
                  </Text>
                </View>
                <Button
                  label="Done"
                  variant="secondary"
                  onPress={() => setOpen(false)}
                  testID="close-theme-modal-button"
                />
              </View>

              <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                keyboardShouldPersistTaps="handled"
              >
                <ThemeGallery inModal />
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const createGalleryStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: {
      gap: spacing.md,
    },
    sectionHeader: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    sectionTitleCol: {
      flex: 1,
      minWidth: 220,
      gap: spacing.xs,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: "800",
      color: colors.text,
    },
    sectionSubtitle: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textMuted,
    },
    currentChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radii.pill,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    currentChipText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.accentPressed,
    },
    filterBar: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    filterPrimary: {
      flexGrow: 1,
      flexBasis: 320,
    },
    filterSecondary: {
      flexShrink: 0,
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.md,
    },
    cardWrap: {
      borderRadius: radii.md,
      overflow: "hidden",
      shadowOpacity: 0.1,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    cardWrapGrid: {
      flexGrow: 1,
      flexBasis: 235,
      minWidth: 220,
      maxWidth: 360,
    },
    cardWrapModal: {
      flexGrow: 1,
      flexBasis: "46%",
      minWidth: 260,
    },
    cardWrapFull: {
      width: "100%",
    },
    cardPressed: {
      opacity: 0.9,
    },
    cardAccentStrip: {
      height: 4,
      width: "100%",
    },
    miniPreview: {
      padding: 10,
      gap: 7,
      borderBottomWidth: 1,
    },
    miniHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    miniBrandPill: {
      width: 18,
      height: 12,
      borderRadius: 4,
      alignItems: "center",
      justifyContent: "center",
    },
    miniBrandDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    miniNavChip: {
      width: 30,
      height: 9,
      borderRadius: 4,
    },
    miniNavChipMuted: {
      width: 24,
      height: 9,
      borderRadius: 4,
    },
    miniSpacer: {
      flex: 1,
    },
    miniCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 8,
      borderRadius: 8,
      borderWidth: 1,
    },
    miniTextCol: {
      flex: 1,
      gap: 5,
    },
    miniLinePrimary: {
      height: 7,
      width: "68%",
      borderRadius: 3,
      opacity: 0.88,
    },
    miniLineMuted: {
      height: 5,
      width: "46%",
      borderRadius: 3,
      opacity: 0.65,
    },
    miniButton: {
      width: 36,
      height: 16,
      borderRadius: 5,
    },
    miniSecondaryDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
    },
    cardBody: {
      padding: 12,
      gap: 6,
    },
    cardTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.xs,
    },
    cardName: {
      fontSize: 15,
      fontWeight: "800",
      flexShrink: 1,
    },
    activeBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radii.pill,
    },
    activeBadgeText: {
      fontSize: 11,
      fontWeight: "700",
    },
    metaBadgeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    metaPill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radii.pill,
    },
    metaPillText: {
      fontSize: 11,
      fontWeight: "700",
    },
    cardTagline: {
      fontSize: 12,
      lineHeight: 17,
    },
  });

const createSwitcherStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      minHeight: 38,
      maxWidth: 175,
      paddingHorizontal: 11,
      paddingVertical: 6,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceSubtle,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    triggerPressed: {
      opacity: 0.8,
    },
    triggerText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
      flexShrink: 1,
    },
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.md,
    },
    modalCard: {
      width: "100%",
      maxWidth: 880,
      maxHeight: "88%",
      backgroundColor: colors.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      overflow: "hidden",
      shadowColor: colors.shadow,
      shadowOpacity: 0.25,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    modalTitleCol: {
      flex: 1,
      gap: 2,
    },
    modalTitle: {
      fontSize: 19,
      fontWeight: "800",
      color: colors.text,
    },
    modalSubtitle: {
      fontSize: 13,
      color: colors.textMuted,
    },
    modalScroll: {
      flexGrow: 0,
    },
    modalScrollContent: {
      padding: spacing.lg,
    },
  });
