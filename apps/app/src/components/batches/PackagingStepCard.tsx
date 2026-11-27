// SPDX-License-Identifier: AGPL-3.0-or-later
import { StyleSheet, Text, View } from "react-native";
import type { BatchDetail, BatchStatus } from "../../api/batches";
import { useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { spacing, type ThemeColors } from "../../theme";
import { CarbonationCalculator } from "../calculators/CarbonationCalculator";
import { Button, Card } from "../ui";
import { formatBatchStatus, formatVolume } from "./batchFlows";

export interface PackagingStepCardProps {
  batch: BatchDetail;
  canEdit: boolean;
  onChangeStatus: (status: BatchStatus) => Promise<void>;
  onOpenCalculators: () => void;
  saving?: boolean;
}

export function PackagingStepCard({
  batch,
  canEdit,
  onChangeStatus,
  onOpenCalculators,
  saving = false,
}: PackagingStepCardProps) {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();
  const targetPackagingStatus: BatchStatus = batch.beverage === "beer" ? "packaged" : "bottled";
  const canMarkPackaged = canEdit && batch.allowedStatuses.includes(targetPackagingStatus);

  return (
    <View style={styles.root} testID="packaging-step-card">
      <Card>
        <View style={styles.headerRow}>
          <View style={styles.headerMeta}>
            <Text style={styles.title}>Packaging & Carbonation</Text>
            <Text style={styles.subtitle}>
              Batch volume: {formatVolume(batch.batchSizeL, unitSystem)} · Current stage:{" "}
              {formatBatchStatus(batch.status)}
            </Text>
          </View>
          <View style={styles.actions}>
            {canMarkPackaged ? (
              <Button
                label={`Mark as ${formatBatchStatus(targetPackagingStatus)}`}
                disabled={saving}
                onPress={() => void onChangeStatus(targetPackagingStatus)}
                testID="packaging-mark-status-button"
              />
            ) : null}
            <Button
              label="All calculators"
              variant="secondary"
              onPress={onOpenCalculators}
              testID="packaging-open-calculators-button"
            />
          </View>
        </View>
        {batch.beverage !== "beer" ? (
          <Text style={styles.tip}>
            Still {batch.beverage}? Use the Stabilize & Backsweeten or Sulfite calculators under All
            Calculators before bottling, or use the priming calculator below for sparkling{" "}
            {batch.beverage}.
          </Text>
        ) : null}
      </Card>

      <CarbonationCalculator initialVolumeL={batch.batchSizeL} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { gap: spacing.lg },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    headerMeta: { flex: 1, minWidth: 200, gap: 4 },
    title: { fontSize: 18, fontWeight: "700", color: colors.text },
    subtitle: { fontSize: 14, color: colors.textMuted },
    actions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
    tip: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  });
