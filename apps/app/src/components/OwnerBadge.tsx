// SPDX-License-Identifier: AGPL-3.0-or-later
import { StyleSheet, Text, View } from "react-native";
import type { Brewery, BreweryRole, ResourceOwner } from "../api/breweries";
import { useOptionalBrewery } from "../state/brewery";
import { formatOwnerLabel, ROLE_LABELS } from "../state/permissions";
import { useThemedStyles } from "../state/theme";
import { radii, type ThemeColors } from "../theme";

export interface OwnerBadgeProps {
  owner: ResourceOwner;
  currentUserId?: string | null;
  breweries?: readonly Pick<Brewery, "id" | "name">[];
  testID?: string;
}

export function OwnerBadge({ owner, currentUserId, breweries, testID }: OwnerBadgeProps) {
  const styles = useThemedStyles(createStyles);
  const ctx = useOptionalBrewery();
  const list = breweries ?? ctx.breweries;
  const info = formatOwnerLabel(owner, currentUserId, list);
  const display = info.isBrewery ? `Brewery: ${info.label}` : info.label;

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`Owned by ${info.label}`}
      style={[
        styles.badge,
        info.isBrewery
          ? styles.badgeBrewery
          : info.isPersonal
            ? styles.badgeMine
            : styles.badgeShared,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.text,
          info.isBrewery
            ? styles.textBrewery
            : info.isPersonal
              ? styles.textMine
              : styles.textShared,
        ]}
      >
        {display}
      </Text>
    </View>
  );
}

export interface RoleBadgeProps {
  role: BreweryRole;
  testID?: string;
}

export function RoleBadge({ role, testID }: RoleBadgeProps) {
  const styles = useThemedStyles(createStyles);
  const label = ROLE_LABELS[role];
  const isOwner = role === "owner";
  const isBrewer = role === "brewer";
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`Role: ${label}`}
      style={[
        styles.badge,
        isOwner ? styles.badgeBrewery : isBrewer ? styles.badgeMine : styles.badgeShared,
      ]}
    >
      <Text
        style={[
          styles.text,
          isOwner ? styles.textBrewery : isBrewer ? styles.textMine : styles.textShared,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    badge: {
      maxWidth: 220,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: radii.pill,
      borderWidth: 1,
      alignSelf: "flex-start",
    },
    badgeBrewery: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    badgeMine: {
      backgroundColor: colors.successSoft,
      borderColor: colors.success,
    },
    badgeShared: {
      backgroundColor: colors.surfaceSubtle,
      borderColor: colors.borderStrong,
    },
    text: {
      fontSize: 12,
      fontWeight: "700",
    },
    textBrewery: {
      color: colors.accentPressed,
    },
    textMine: {
      color: colors.success,
    },
    textShared: {
      color: colors.textMuted,
    },
  });
