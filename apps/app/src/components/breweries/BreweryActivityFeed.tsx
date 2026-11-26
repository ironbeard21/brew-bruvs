// SPDX-License-Identifier: AGPL-3.0-or-later
import { Pressable, StyleSheet, Text, View } from "react-native";
import { type ActivityEvent, useBreweryActivity } from "../../api/activity";
import { colors, radii, spacing } from "../../theme";
import { formatBatchStatus, formatDateTime } from "../batches/batchFlows";
import { Banner, Button, Card } from "../ui";

export function describeActivityEvent(event: ActivityEvent): {
  badge: string;
  summary: string;
  target: { kind: "batch"; id: string } | { kind: "equipment"; id: string } | null;
} {
  const actor = event.actor?.displayName?.trim() || null;
  const batchName = event.batch?.name ?? "a batch";
  const itemName = event.name ?? "an item";

  switch (event.verb) {
    case "batch_started":
      return {
        badge: "Batch",
        summary: `${actor ?? "Someone"} started batch ${batchName}${event.status ? ` (${formatBatchStatus(event.status)})` : ""}.`,
        target: event.batch ? { kind: "batch", id: event.batch.id } : null,
      };
    case "batch_moved":
      return {
        badge: "Stage",
        summary: `${actor ?? "Someone"} moved ${batchName} to ${event.status ? formatBatchStatus(event.status) : "a new stage"}.`,
        target: event.batch ? { kind: "batch", id: event.batch.id } : null,
      };
    case "reading_logged":
      return {
        badge: "Reading",
        summary: `${actor ?? "A connected device"} logged a reading on ${batchName}.`,
        target: event.batch ? { kind: "batch", id: event.batch.id } : null,
      };
    case "inventory_used":
      return {
        badge: "Inventory",
        summary: `${actor ?? "Someone"} used reserved inventory for ${event.batch ? batchName : itemName}.`,
        target: event.batch ? { kind: "batch", id: event.batch.id } : null,
      };
    case "member_joined":
      return {
        badge: "Member",
        summary: `${event.name ?? actor ?? "A new member"} joined the brewery.`,
        target: null,
      };
    case "item_lent":
      return {
        badge: "Lent",
        summary: `${actor ?? "Someone"} lent out ${itemName}.`,
        target: { kind: "equipment", id: event.object.id },
      };
    case "item_returned":
      return {
        badge: "Returned",
        summary: `${actor ?? "Someone"} marked ${itemName} returned.`,
        target: { kind: "equipment", id: event.object.id },
      };
    default: {
      const verbText = event.verb.replaceAll("_", " ");
      const subject = event.batch?.name ?? event.name;
      return {
        badge: "Activity",
        summary: `${actor ?? "Someone"} ${verbText}${subject ? ` (${subject})` : ""}.`,
        target: event.batch ? { kind: "batch", id: event.batch.id } : null,
      };
    }
  }
}

export interface BreweryActivityFeedProps {
  serverUrl: string;
  authToken: string | null;
  breweryId: string;
  breweryName: string;
  onOpenBatch?: (batchId: string) => void;
  onOpenEquipment?: () => void;
  pageSize?: number;
  customFetch?: typeof fetch;
}

export function BreweryActivityFeed({
  serverUrl,
  authToken,
  breweryId,
  breweryName,
  onOpenBatch,
  onOpenEquipment,
  pageSize,
  customFetch,
}: BreweryActivityFeedProps) {
  const activityQuery = useBreweryActivity(
    serverUrl,
    authToken,
    breweryId,
    { ...(pageSize ? { limit: pageSize } : {}), enabled: true },
    customFetch,
  );

  const events = activityQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <View testID="brewery-activity-feed">
      <Card>
        <View style={styles.header}>
          <View style={styles.headerCol}>
            <Text style={styles.title}>Activity Feed</Text>
            <Text style={styles.subtitle}>
              Recent batches, readings, inventory, members, and equipment loans in {breweryName}.
            </Text>
          </View>
          <Button
            label={activityQuery.isRefetching ? "Refreshing..." : "Refresh"}
            variant="ghost"
            disabled={activityQuery.isRefetching}
            onPress={() => void activityQuery.refetch()}
            accessibilityLabel={`Refresh ${breweryName} activity feed`}
            testID="activity-refresh-button"
          />
        </View>

        {activityQuery.isPending ? (
          <Banner tone="info" message="Loading activity..." />
        ) : activityQuery.isError ? (
          <Banner
            tone="error"
            message={
              activityQuery.error instanceof Error
                ? activityQuery.error.message
                : "Could not load brewery activity."
            }
            testID="activity-error"
          />
        ) : events.length === 0 ? (
          <Text style={styles.emptyText} testID="activity-empty">
            No brewery activity yet. Start a batch, log a reading, invite a member, or lend
            equipment to see updates here.
          </Text>
        ) : (
          <View style={styles.list} testID="activity-list">
            {events.map((event) => {
              const info = describeActivityEvent(event);
              const canNavigate =
                (info.target?.kind === "batch" && Boolean(onOpenBatch)) ||
                (info.target?.kind === "equipment" && Boolean(onOpenEquipment));
              const handlePress = () => {
                if (info.target?.kind === "batch" && onOpenBatch) {
                  onOpenBatch(info.target.id);
                } else if (info.target?.kind === "equipment" && onOpenEquipment) {
                  onOpenEquipment();
                }
              };

              const content = (
                <View style={styles.eventInner}>
                  <View style={styles.eventMetaRow}>
                    <View style={styles.verbPill}>
                      <Text style={styles.verbPillText}>{info.badge}</Text>
                    </View>
                    <Text style={styles.eventTime}>{formatDateTime(event.at)}</Text>
                  </View>
                  <Text style={styles.eventSummary}>{info.summary}</Text>
                </View>
              );

              if (canNavigate) {
                return (
                  <Pressable
                    key={event.id}
                    onPress={handlePress}
                    accessibilityRole="button"
                    accessibilityLabel={info.summary}
                    testID={`activity-event-${event.id}`}
                    style={({ pressed }) => [styles.eventRow, pressed && styles.eventRowPressed]}
                  >
                    {content}
                  </Pressable>
                );
              }

              return (
                <View key={event.id} style={styles.eventRow} testID={`activity-event-${event.id}`}>
                  {content}
                </View>
              );
            })}

            {activityQuery.hasNextPage ? (
              <Button
                label={activityQuery.isFetchingNextPage ? "Loading more..." : "Load more activity"}
                variant="secondary"
                disabled={activityQuery.isFetchingNextPage}
                onPress={() => void activityQuery.fetchNextPage()}
                testID="activity-load-more"
              />
            ) : null}
          </View>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  headerCol: { flex: 1, gap: 2 },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  subtitle: { fontSize: 12, color: colors.textMuted },
  emptyText: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  list: { gap: spacing.xs },
  eventRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eventRowPressed: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  eventInner: { gap: 4 },
  eventMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.xs,
  },
  verbPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  verbPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.accentPressed,
  },
  eventTime: { fontSize: 11, color: colors.textMuted },
  eventSummary: { fontSize: 14, lineHeight: 20, color: colors.text },
});
