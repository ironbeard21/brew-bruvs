// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Brewery } from "../../api/breweries";
import { ROLE_LABELS } from "../../state/permissions";
import { useThemedStyles } from "../../state/theme";
import { spacing, type ThemeColors } from "../../theme";
import { Banner, Button, Card, SegmentedControl } from "../ui";

const ME_VALUE = "__me__";

export interface OwnerPickerCardProps {
  label?: string;
  writableBreweries: readonly Brewery[];
  selectedBreweryId: string | null;
  onChangeBreweryId: (breweryId: string | null) => void;
  testID?: string;
}

/** Lets a user pick whether a newly created item belongs to "Me" or a brewery they can write to. */
export function OwnerPickerCard({
  label = "Owner",
  writableBreweries,
  selectedBreweryId,
  onChangeBreweryId,
  testID = "owner-picker-card",
}: OwnerPickerCardProps) {
  const styles = useThemedStyles(createStyles);
  if (writableBreweries.length === 0) return null;

  const options = [
    { value: ME_VALUE, label: "Me", accessibilityLabel: "Personal (Me)" },
    ...writableBreweries.map((b) => ({
      value: b.id,
      label: b.name,
      accessibilityLabel: `${b.name} (${ROLE_LABELS[b.role]})`,
    })),
  ];

  return (
    <Card>
      <View style={styles.col} testID={testID}>
        <Text style={styles.title}>{label}</Text>
        <SegmentedControl
          options={options}
          value={selectedBreweryId ?? ME_VALUE}
          onChange={(next) => onChangeBreweryId(next === ME_VALUE ? null : next)}
          accessibilityLabel={`Select ${label.toLowerCase()}`}
          compact
        />
      </View>
    </Card>
  );
}

export interface MoveToBreweryBarProps {
  itemLabel: string;
  writableBreweries: readonly Brewery[];
  moving: boolean;
  onMove: (breweryId: string) => Promise<void>;
  testID?: string;
}

/** Compact inline control to move a personal item into a brewery where the user is Owner or Brewer. */
export function MoveToBreweryBar({
  itemLabel,
  writableBreweries,
  moving,
  onMove,
  testID = "move-to-brewery",
}: MoveToBreweryBarProps) {
  const styles = useThemedStyles(createStyles);
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState<string>(writableBreweries[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  if (writableBreweries.length === 0) return null;

  const resolvedTarget = writableBreweries.some((b) => b.id === targetId)
    ? targetId
    : (writableBreweries[0]?.id ?? "");

  const handleConfirm = async () => {
    if (!resolvedTarget) return;
    setError(null);
    try {
      await onMove(resolvedTarget);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not move ${itemLabel}.`);
    }
  };

  if (!open) {
    return (
      <Button
        label="Move to brewery"
        variant="secondary"
        onPress={() => setOpen(true)}
        testID={`${testID}-open`}
      />
    );
  }

  return (
    <Card>
      <View style={styles.col} testID={`${testID}-panel`}>
        <Text style={styles.title}>Move {itemLabel} to a brewery</Text>
        <Text style={styles.muted}>
          Only breweries where you are an Owner or Brewer are listed.
        </Text>
        <SegmentedControl
          options={writableBreweries.map((b) => ({
            value: b.id,
            label: b.name,
            accessibilityLabel: `Move to ${b.name}`,
          }))}
          value={resolvedTarget}
          onChange={setTargetId}
          accessibilityLabel="Target brewery"
          compact
        />
        {error ? <Banner tone="error" message={error} testID={`${testID}-error`} /> : null}
        <View style={styles.row}>
          <Button
            label={moving ? "Moving..." : "Confirm move"}
            disabled={moving || !resolvedTarget}
            onPress={() => void handleConfirm()}
            testID={`${testID}-confirm`}
          />
          <Button label="Cancel" variant="ghost" onPress={() => setOpen(false)} />
        </View>
      </View>
    </Card>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    col: { gap: spacing.xs },
    row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    title: { fontSize: 15, fontWeight: "700", color: colors.text },
    muted: { fontSize: 13, color: colors.textMuted },
  });
