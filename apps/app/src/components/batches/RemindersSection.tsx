// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { Reminder, ReminderInput, ReminderKind } from "../../api/batches";
import { cancelReminderNotification, syncReminderNotifications } from "../../notifications";
import { colors, DESKTOP_BREAKPOINT, radii, spacing } from "../../theme";
import { Banner, Button, Card, SegmentedControl, TextField } from "../ui";
import { formatDateTime, formatReminderKind } from "./batchFlows";

export interface RemindersSectionProps {
  reminders: readonly Reminder[];
  loading?: boolean;
  canEdit: boolean;
  scopeKey?: string;
  onAddReminder: (input: ReminderInput) => Promise<void>;
  onCompleteReminder: (reminderId: string) => Promise<void>;
  saving?: boolean;
}

const KIND_OPTIONS: readonly { value: ReminderKind; label: string }[] = [
  { value: "nutrient", label: "Nutrient" },
  { value: "rack", label: "Rack" },
  { value: "sulfite", label: "Sulfite" },
  { value: "taste", label: "Taste" },
  { value: "ready", label: "Ready" },
  { value: "custom", label: "Custom" },
];

const QUICK_DAYS = [1, 3, 7, 14, 30] as const;

function isoDateDaysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export function RemindersSection({
  reminders,
  loading = false,
  canEdit,
  scopeKey,
  onAddReminder,
  onCompleteReminder,
  saving = false,
}: RemindersSectionProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const [kind, setKind] = useState<ReminderKind>("rack");
  const [dueDateText, setDueDateText] = useState(() => isoDateDaysFromNow(7));
  const [noteText, setNoteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Automatically sync upcoming batch reminders to local device notifications on native
  useEffect(() => {
    if (Platform.OS === "web" || reminders.length === 0) return;
    let active = true;
    void syncReminderNotifications([...reminders], {
      ...(scopeKey ? { scopeKey } : {}),
    }).then((res) => {
      if (!active) return;
      if (res.permissionGranted && res.scheduled > 0) {
        setSyncMessage(
          `${res.scheduled} upcoming reminder${res.scheduled === 1 ? "" : "s"} scheduled as local notifications.`,
        );
      }
    });
    return () => {
      active = false;
    };
  }, [reminders, scopeKey]);

  const handleSyncNotifications = async () => {
    if (Platform.OS === "web") {
      setSyncMessage("Local reminder notifications run automatically on iOS & Android.");
      return;
    }
    const res = await syncReminderNotifications([...reminders], {
      ...(scopeKey ? { scopeKey } : {}),
    });
    setSyncMessage(
      res.permissionGranted
        ? `Synced ${res.scheduled} upcoming reminder${res.scheduled === 1 ? "" : "s"} to device alerts.`
        : "Notification permission is disabled in device settings.",
    );
  };

  const handleComplete = async (reminderId: string) => {
    setError(null);
    try {
      await onCompleteReminder(reminderId);
      await cancelReminderNotification(reminderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete reminder.");
    }
  };

  const handleAdd = async () => {
    setError(null);
    const trimmedDate = dueDateText.trim();
    const parsed = Date.parse(trimmedDate.includes("T") ? trimmedDate : `${trimmedDate}T12:00:00Z`);
    if (!Number.isFinite(parsed)) {
      setError("Enter a valid due date (YYYY-MM-DD).");
      return;
    }
    const trimmedNote = noteText.trim();
    try {
      await onAddReminder({
        kind,
        dueAt: new Date(parsed).toISOString(),
        ...(trimmedNote ? { note: trimmedNote } : {}),
      });
      setNoteText("");
      setDueDateText(isoDateDaysFromNow(7));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create reminder.");
    }
  };

  const now = Date.now();
  const pending = reminders.filter((r) => !r.doneAt);
  const completed = reminders.filter((r) => Boolean(r.doneAt));

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]} testID="reminders-section">
      {/* Reminder List */}
      <Card style={isDesktop ? styles.column : undefined}>
        <View style={styles.headerRow}>
          <View style={styles.headerMeta}>
            <Text style={styles.sectionTitle}>Batch Reminders ({pending.length} active)</Text>
            <Text style={styles.muted}>
              Upcoming reminders schedule as local device alerts (no cloud push service).
            </Text>
          </View>
          <Button
            label="Sync alerts"
            variant="secondary"
            onPress={() => void handleSyncNotifications()}
            testID="sync-reminders-button"
          />
        </View>

        {syncMessage ? <Banner tone="info" message={syncMessage} /> : null}
        {error ? <Banner tone="error" message={error} testID="reminder-error" /> : null}
        {loading ? <Banner tone="info" message="Loading reminders..." /> : null}

        {!loading && reminders.length === 0 ? (
          <Text style={styles.muted}>
            No reminders yet. Mead batches automatically receive staggered nutrient reminders when
            moved to Primary.
          </Text>
        ) : (
          <View style={styles.list}>
            {pending.map((r, idx) => {
              const isOverdue = Date.parse(r.dueAt) < now;
              return (
                <View
                  key={r.id}
                  style={[styles.reminderRow, isOverdue && styles.reminderOverdue]}
                  testID={`reminder-pending-${idx}`}
                >
                  <View style={styles.reminderBody}>
                    <View style={styles.badgeRow}>
                      <View style={styles.kindBadge}>
                        <Text style={styles.kindBadgeText}>{formatReminderKind(r.kind)}</Text>
                      </View>
                      <Text style={[styles.dueText, isOverdue && styles.dueTextOverdue]}>
                        {isOverdue ? "Overdue · " : "Due "}
                        {formatDateTime(r.dueAt)}
                      </Text>
                    </View>
                    {r.note ? <Text style={styles.noteText}>{r.note}</Text> : null}
                  </View>
                  {canEdit ? (
                    <Button
                      label="Mark done"
                      variant="secondary"
                      disabled={saving}
                      onPress={() => void handleComplete(r.id)}
                      testID={`reminder-done-button-${idx}`}
                    />
                  ) : null}
                </View>
              );
            })}

            {completed.length > 0 ? (
              <View style={styles.completedSection}>
                <Text style={styles.completedHeader}>Completed ({completed.length})</Text>
                {completed.map((r, idx) => (
                  <View
                    key={r.id}
                    style={[styles.reminderRow, styles.reminderDone]}
                    testID={`reminder-completed-${idx}`}
                  >
                    <View style={styles.reminderBody}>
                      <Text style={styles.doneTitle}>
                        ✓ {formatReminderKind(r.kind)} · {formatDateTime(r.dueAt)}
                      </Text>
                      {r.note ? <Text style={styles.muted}>{r.note}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )}
      </Card>

      {/* Add Reminder Form */}
      {canEdit ? (
        <Card style={isDesktop ? styles.column : undefined}>
          <Text style={styles.sectionTitle}>Add Reminder</Text>
          <SegmentedControl
            options={KIND_OPTIONS}
            value={kind}
            onChange={setKind}
            accessibilityLabel="Reminder kind"
          />

          <View style={styles.quickDaysRow}>
            {QUICK_DAYS.map((days) => (
              <Button
                key={days}
                label={`+${days}d`}
                variant="secondary"
                onPress={() => setDueDateText(isoDateDaysFromNow(days))}
                testID={`reminder-quick-${days}d`}
              />
            ))}
          </View>

          <TextField
            label="Due Date"
            value={dueDateText}
            onChangeText={setDueDateText}
            placeholder="YYYY-MM-DD"
            helper="ISO date (YYYY-MM-DD) or full ISO timestamp"
            testID="reminder-due-input"
          />

          <TextField
            label="Note (optional)"
            value={noteText}
            onChangeText={setNoteText}
            placeholder="e.g. Rack off gross lees & add Fermaid O"
            testID="reminder-note-input"
          />

          <Button
            label={saving ? "Saving..." : "Schedule reminder"}
            disabled={saving}
            onPress={() => void handleAdd()}
            testID="reminder-submit-button"
          />
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  layout: { gap: spacing.lg },
  layoutDesktop: { flexDirection: "row", alignItems: "flex-start" },
  column: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  headerMeta: { flex: 1, minWidth: 180, gap: 2 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  muted: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  list: { gap: spacing.sm },
  reminderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
  reminderOverdue: {
    backgroundColor: colors.errorSoft,
    borderColor: colors.error,
  },
  reminderDone: {
    backgroundColor: colors.surface,
    opacity: 0.78,
  },
  reminderBody: { flex: 1, minWidth: 180, gap: 4 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  kindBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
  },
  kindBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.accentPressed,
  },
  dueText: { fontSize: 13, fontWeight: "600", color: colors.text },
  dueTextOverdue: { color: colors.error },
  noteText: { fontSize: 14, color: colors.text },
  completedSection: { gap: spacing.xs, marginTop: spacing.sm },
  completedHeader: { fontSize: 13, fontWeight: "700", color: colors.textMuted },
  doneTitle: { fontSize: 14, fontWeight: "600", color: colors.success },
  quickDaysRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
});
