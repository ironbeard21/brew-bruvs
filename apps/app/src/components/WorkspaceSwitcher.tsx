// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useOptionalBrewery } from "../state/brewery";
import { ROLE_LABELS } from "../state/permissions";
import { colors, DESKTOP_BREAKPOINT, radii, spacing } from "../theme";

export interface WorkspaceSwitcherProps {
  signedIn: boolean;
}

export function WorkspaceSwitcher({ signedIn }: WorkspaceSwitcherProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const { activeBreweryId, breweries, myInvitesCount, setActiveBreweryId } = useOptionalBrewery();

  if (!signedIn) return null;

  return (
    <View style={styles.barOuter} testID="workspace-switcher">
      <View style={[styles.barWrap, isDesktop && styles.barWrapDesktop]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.barInner}
        >
          <Text style={styles.label}>Workspace:</Text>
          <Pressable
            onPress={() => setActiveBreweryId(null)}
            accessibilityRole="tab"
            accessibilityLabel="Switch workspace to Me (personal)"
            accessibilityState={{ selected: activeBreweryId === null }}
            testID="workspace-switch-me"
            style={[styles.pill, activeBreweryId === null && styles.pillActive]}
          >
            <Text style={[styles.pillText, activeBreweryId === null && styles.pillTextActive]}>
              Me
            </Text>
          </Pressable>

          {breweries.map((b) => {
            const selected = activeBreweryId === b.id;
            return (
              <Pressable
                key={b.id}
                onPress={() => setActiveBreweryId(b.id)}
                accessibilityRole="tab"
                accessibilityLabel={`Switch workspace to ${b.name} (${ROLE_LABELS[b.role]})`}
                accessibilityState={{ selected }}
                testID={`workspace-switch-${b.id}`}
                style={[styles.pill, selected && styles.pillActive]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.pillText, selected && styles.pillTextActive]}
                >
                  {b.name} · {ROLE_LABELS[b.role]}
                </Text>
              </Pressable>
            );
          })}

          <Pressable
            onPress={() => router.push("/breweries")}
            accessibilityRole="button"
            accessibilityLabel={
              myInvitesCount > 0
                ? `Manage breweries (${myInvitesCount} pending invites)`
                : "Manage breweries"
            }
            testID="workspace-manage-breweries"
            style={styles.manageLink}
          >
            <Text style={styles.manageLinkText}>
              {myInvitesCount > 0
                ? `Invites (${myInvitesCount})`
                : breweries.length === 0
                  ? "+ Create or join brewery"
                  : "Manage"}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  barOuter: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
  barWrap: {
    width: "100%",
    maxWidth: 1120,
    alignSelf: "center",
    paddingHorizontal: spacing.md,
  },
  barWrapDesktop: {
    paddingHorizontal: spacing.lg,
  },
  barInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    gap: spacing.xs,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    marginRight: 2,
  },
  pill: {
    minHeight: 30,
    maxWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    justifyContent: "center",
  },
  pillActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  pillTextActive: {
    color: colors.accentPressed,
    fontWeight: "700",
  },
  manageLink: {
    minHeight: 30,
    paddingHorizontal: 8,
    paddingVertical: 4,
    justifyContent: "center",
  },
  manageLinkText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.accent,
  },
});
