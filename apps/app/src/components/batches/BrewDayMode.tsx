// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { Beverage, RecipeVersion } from "../../api/recipes";
import {
  cancelLocalNotification,
  fireWebNotification,
  requestNotificationPermission,
  scheduleTimerNotification,
} from "../../notifications";
import { appStorage } from "../../state/storage";
import { useThemedStyles } from "../../state/theme";
import { useUnits } from "../../state/units";
import { DESKTOP_BREAKPOINT, radii, spacing, type ThemeColors } from "../../theme";
import { parseNumber } from "../calculators/parseNumber";
import { Banner, Button, Card, TextField } from "../ui";
import { type BrewDayTimerSpec, buildBrewDayPlan, formatDuration } from "./batchFlows";

export interface BrewDayModeProps {
  batchId: string;
  batchName: string;
  beverage: Beverage;
  recipeVersion: RecipeVersion | null | undefined;
  loadingRecipe?: boolean;
}

interface TimerRuntimeState {
  status: "idle" | "running" | "paused" | "done";
  remainingSec: number;
  endsAtMs: number | null;
  startedAtMs: number | null;
  notificationIds: string[];
  firedAlertIds: string[];
}

interface PersistedBrewDayState {
  checkedSteps: Record<string, boolean>;
  timers: Record<string, TimerRuntimeState>;
  customTimers: BrewDayTimerSpec[];
}

function storageKey(batchId: string): string {
  return `brewbruvs.brewday.${batchId}`;
}

function defaultTimerState(durationSec: number): TimerRuntimeState {
  return {
    status: "idle",
    remainingSec: durationSec,
    endsAtMs: null,
    startedAtMs: null,
    notificationIds: [],
    firedAlertIds: [],
  };
}

export function BrewDayMode({
  batchId,
  batchName,
  beverage,
  recipeVersion,
  loadingRecipe = false,
}: BrewDayModeProps) {
  const styles = useThemedStyles(createStyles);
  const { unitSystem } = useUnits();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  const plan = useMemo(
    () => buildBrewDayPlan(recipeVersion, beverage, unitSystem),
    [recipeVersion, beverage, unitSystem],
  );

  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});
  const [timers, setTimers] = useState<Record<string, TimerRuntimeState>>({});
  const [customTimers, setCustomTimers] = useState<BrewDayTimerSpec[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [alertBanner, setAlertBanner] = useState<string | null>(null);
  const [notifPermission, setNotifPermission] = useState<"unknown" | "granted" | "denied">(
    "unknown",
  );
  const [customLabel, setCustomLabel] = useState("");
  const [customMinutes, setCustomMinutes] = useState("15");

  const allTimerSpecs = useMemo(
    () => [...plan.timers, ...customTimers],
    [plan.timers, customTimers],
  );

  // Hydrate checklist and timer state from local storage
  useEffect(() => {
    let active = true;
    void appStorage.getItem(storageKey(batchId)).then((raw) => {
      if (!active) return;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<PersistedBrewDayState>;
          if (parsed.checkedSteps) setCheckedSteps(parsed.checkedSteps);
          if (parsed.timers) setTimers(parsed.timers);
          if (Array.isArray(parsed.customTimers)) setCustomTimers(parsed.customTimers);
        } catch {
          // Ignore corrupt local state
        }
      }
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, [batchId]);

  // Persist changes
  useEffect(() => {
    if (!hydrated) return;
    const payload: PersistedBrewDayState = {
      checkedSteps,
      timers,
      customTimers,
    };
    void appStorage.setItem(storageKey(batchId), JSON.stringify(payload));
  }, [batchId, checkedSteps, timers, customTimers, hydrated]);

  // Keep refs to specs for the 1s tick
  const specsRef = useRef(allTimerSpecs);
  specsRef.current = allTimerSpecs;

  const hasRunningTimer = useMemo(
    () => Object.values(timers).some((t) => t.status === "running"),
    [timers],
  );

  useEffect(() => {
    if (!hasRunningTimer) return;
    const interval = setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      setTimers((prev) => {
        let changed = false;
        const next: Record<string, TimerRuntimeState> = { ...prev };
        for (const spec of specsRef.current) {
          const st = prev[spec.id];
          if (st?.status !== "running" || st.endsAtMs == null) continue;

          const remaining = Math.max(0, Math.ceil((st.endsAtMs - current) / 1000));
          const elapsed = spec.durationSec - remaining;

          // Fire intermediate hop alerts (web + in-app banner)
          let firedAlertIds = st.firedAlertIds;
          for (const alert of spec.alerts) {
            if (elapsed >= alert.fireAfterSec && !firedAlertIds.includes(alert.id)) {
              firedAlertIds = [...firedAlertIds, alert.id];
              setAlertBanner(`${batchName}: ${alert.label}`);
              fireWebNotification(`${batchName} · Brew Day`, alert.label);
              changed = true;
            }
          }

          if (remaining <= 0) {
            changed = true;
            next[spec.id] = {
              ...st,
              status: "done",
              remainingSec: 0,
              endsAtMs: null,
              firedAlertIds,
            };
            setAlertBanner(`${batchName}: ${spec.label} complete!`);
            fireWebNotification(`${batchName} · Timer complete`, `${spec.label} has finished.`);
          } else if (firedAlertIds !== st.firedAlertIds) {
            next[spec.id] = { ...st, firedAlertIds };
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [hasRunningTimer, batchName]);

  const getRuntime = useCallback(
    (spec: BrewDayTimerSpec): TimerRuntimeState =>
      timers[spec.id] ?? defaultTimerState(spec.durationSec),
    [timers],
  );

  const handleEnableAlerts = async () => {
    const granted = await requestNotificationPermission();
    setNotifPermission(granted ? "granted" : "denied");
  };

  const handleStartTimer = async (spec: BrewDayTimerSpec) => {
    const current = getRuntime(spec);
    const remainingSec =
      current.status === "paused" && current.remainingSec > 0
        ? current.remainingSec
        : spec.durationSec;
    const now = Date.now();
    const endsAtMs = now + remainingSec * 1000;
    const elapsedAlready = spec.durationSec - remainingSec;

    // Schedule local notifications for timer completion and any remaining hop-addition alerts
    const notifIds: string[] = [];
    const mainNotifId = await scheduleTimerNotification({
      title: `${batchName}: ${spec.label} complete`,
      body: `${spec.label} (${spec.detail}) finished.`,
      triggerAtMs: endsAtMs,
    });
    if (mainNotifId) notifIds.push(mainNotifId);

    for (const alert of spec.alerts) {
      const secFromNow = alert.fireAfterSec - elapsedAlready;
      if (secFromNow > 0) {
        const alertId = await scheduleTimerNotification({
          title: `${batchName}: Hop addition`,
          body: alert.label,
          triggerAtMs: now + secFromNow * 1000,
        });
        if (alertId) notifIds.push(alertId);
      }
    }

    setNowMs(now);
    setTimers((prev) => ({
      ...prev,
      [spec.id]: {
        status: "running",
        remainingSec,
        endsAtMs,
        startedAtMs: now,
        notificationIds: notifIds,
        firedAlertIds: current.status === "paused" ? current.firedAlertIds : [],
      },
    }));
  };

  const handlePauseTimer = async (spec: BrewDayTimerSpec) => {
    const current = getRuntime(spec);
    if (current.status !== "running" || current.endsAtMs == null) return;
    const remainingSec = Math.max(0, Math.ceil((current.endsAtMs - Date.now()) / 1000));
    await Promise.all(current.notificationIds.map((id) => cancelLocalNotification(id)));
    setTimers((prev) => ({
      ...prev,
      [spec.id]: {
        ...current,
        status: "paused",
        remainingSec,
        endsAtMs: null,
        notificationIds: [],
      },
    }));
  };

  const handleResetTimer = async (spec: BrewDayTimerSpec) => {
    const current = getRuntime(spec);
    await Promise.all(current.notificationIds.map((id) => cancelLocalNotification(id)));
    setTimers((prev) => ({
      ...prev,
      [spec.id]: defaultTimerState(spec.durationSec),
    }));
  };

  const handleAddCustomTimer = () => {
    const mins = parseNumber(customMinutes);
    if (mins == null || mins <= 0) return;
    const label = customLabel.trim() || `Custom timer (${mins} min)`;
    const spec: BrewDayTimerSpec = {
      id: `timer-custom-${Date.now()}`,
      kind: "custom",
      label,
      detail: `${mins} min custom timer`,
      durationSec: Math.round(mins * 60),
      alerts: [],
    };
    setCustomTimers((prev) => [...prev, spec]);
    setCustomLabel("");
    setCustomMinutes("15");
  };

  const toggleStep = (stepId: string) => {
    setCheckedSteps((prev) => ({ ...prev, [stepId]: !prev[stepId] }));
  };

  const completedCount = plan.steps.filter((s) => checkedSteps[s.id]).length;

  return (
    <View style={[styles.layout, isDesktop && styles.layoutDesktop]} testID="brew-day-mode">
      {/* Checklist column */}
      <Card style={isDesktop ? styles.column : undefined}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.sectionTitle}>Brew-Day Checklist</Text>
            <Text style={styles.muted}>
              {completedCount} of {plan.steps.length} steps checked
              {recipeVersion ? ` · from recipe v${recipeVersion.version}` : ""}
            </Text>
          </View>
        </View>

        {loadingRecipe ? <Banner tone="info" message="Loading recipe steps..." /> : null}

        <View style={styles.stepList}>
          {plan.steps.map((step, idx) => {
            const done = Boolean(checkedSteps[step.id]);
            return (
              <Pressable
                key={step.id}
                onPress={() => toggleStep(step.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                accessibilityLabel={step.title}
                testID={`brew-step-${idx}`}
                style={[styles.stepRow, done && styles.stepRowDone]}
              >
                <View style={[styles.checkbox, done && styles.checkboxChecked]}>
                  {done ? <Text style={styles.checkmark}>✓</Text> : null}
                </View>
                <View style={styles.stepBody}>
                  <Text style={[styles.stepTitle, done && styles.stepTitleDone]}>{step.title}</Text>
                  <Text style={styles.stepDetail}>{step.detail}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {/* Timers column */}
      <Card style={isDesktop ? styles.column : undefined}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.sectionTitle}>Brew-Day Timers</Text>
            <Text style={styles.muted}>
              Mash, boil, and hop-addition timers schedule local device alerts even in the
              background.
            </Text>
          </View>
          {notifPermission !== "granted" ? (
            <Button
              label="Enable alerts"
              variant="secondary"
              onPress={() => void handleEnableAlerts()}
              testID="enable-timer-alerts-button"
            />
          ) : null}
        </View>

        {notifPermission === "granted" ? (
          <Banner tone="success" message="Local timer notifications enabled on this device." />
        ) : notifPermission === "denied" ? (
          <Banner
            tone="info"
            message="Notification permission was declined; timers still count down on screen."
          />
        ) : null}

        {alertBanner ? (
          <Banner tone="success" message={alertBanner} testID="brew-timer-alert-banner" />
        ) : null}

        {allTimerSpecs.length === 0 ? (
          <Banner
            tone="info"
            message="No timed mash or boil steps in this recipe. Add a custom timer below."
          />
        ) : (
          <View style={styles.timerList}>
            {allTimerSpecs.map((spec, idx) => {
              const st = getRuntime(spec);
              const displaySec =
                st.status === "running" && st.endsAtMs != null
                  ? Math.max(0, Math.ceil((st.endsAtMs - nowMs) / 1000))
                  : st.remainingSec;

              return (
                <View
                  key={spec.id}
                  style={[
                    styles.timerCard,
                    st.status === "running" && styles.timerCardRunning,
                    st.status === "done" && styles.timerCardDone,
                  ]}
                  testID={`brew-timer-${idx}`}
                >
                  <View style={styles.timerTop}>
                    <View style={styles.timerMeta}>
                      <Text style={styles.timerLabel}>{spec.label}</Text>
                      <Text style={styles.timerDetail}>{spec.detail}</Text>
                    </View>
                    <Text
                      style={[styles.timerClock, st.status === "done" && styles.timerClockDone]}
                      testID={`brew-timer-clock-${idx}`}
                    >
                      {st.status === "done" ? "DONE" : formatDuration(displaySec)}
                    </Text>
                  </View>

                  {spec.alerts.length > 0 ? (
                    <View style={styles.hopAlertsBox}>
                      {spec.alerts.map((alert) => (
                        <Text key={alert.id} style={styles.hopAlertText}>
                          • {alert.label}
                        </Text>
                      ))}
                    </View>
                  ) : null}

                  <View style={styles.timerActions}>
                    {st.status === "running" ? (
                      <Button
                        label="Pause"
                        variant="secondary"
                        onPress={() => void handlePauseTimer(spec)}
                        testID={`brew-timer-pause-${idx}`}
                      />
                    ) : (
                      <Button
                        label={st.status === "paused" ? "Resume" : "Start"}
                        variant="primary"
                        onPress={() => void handleStartTimer(spec)}
                        testID={`brew-timer-start-${idx}`}
                      />
                    )}
                    <Button
                      label="Reset"
                      variant="ghost"
                      onPress={() => void handleResetTimer(spec)}
                      testID={`brew-timer-reset-${idx}`}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.customTimerBox}>
          <Text style={styles.subHeading}>Add custom timer</Text>
          <View style={styles.customRow}>
            <View style={styles.customLabelField}>
              <TextField
                label="Label"
                value={customLabel}
                onChangeText={setCustomLabel}
                placeholder="e.g. Vorlauf, Whirlfloc"
                testID="custom-timer-label-input"
              />
            </View>
            <View style={styles.customMinField}>
              <TextField
                label="Minutes"
                value={customMinutes}
                onChangeText={setCustomMinutes}
                unit="min"
                keyboardType="decimal-pad"
                testID="custom-timer-minutes-input"
              />
            </View>
          </View>
          <Button
            label="Add timer"
            variant="secondary"
            onPress={handleAddCustomTimer}
            testID="add-custom-timer-button"
          />
        </View>
      </Card>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
    headerText: {
      flex: 1,
      minWidth: 180,
      gap: 2,
    },
    sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
    subHeading: { fontSize: 15, fontWeight: "700", color: colors.text },
    muted: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
    stepList: { gap: spacing.sm },
    stepRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    stepRowDone: {
      backgroundColor: colors.surfaceSubtle,
      borderColor: colors.border,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: colors.borderStrong,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    checkboxChecked: {
      backgroundColor: colors.success,
      borderColor: colors.success,
    },
    checkmark: {
      color: colors.accentText,
      fontSize: 14,
      fontWeight: "800",
    },
    stepBody: {
      flex: 1,
      gap: 2,
    },
    stepTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.text,
    },
    stepTitleDone: {
      textDecorationLine: "line-through",
      color: colors.textMuted,
    },
    stepDetail: {
      fontSize: 13,
      color: colors.textMuted,
    },
    timerList: { gap: spacing.sm },
    timerCard: {
      padding: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceSubtle,
      gap: spacing.sm,
    },
    timerCardRunning: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    timerCardDone: {
      backgroundColor: colors.successSoft,
      borderColor: colors.success,
    },
    timerTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.sm,
    },
    timerMeta: {
      flex: 1,
      gap: 2,
    },
    timerLabel: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.text,
    },
    timerDetail: {
      fontSize: 12,
      color: colors.textMuted,
    },
    timerClock: {
      fontSize: 22,
      fontWeight: "800",
      color: colors.accentPressed,
      fontVariant: ["tabular-nums"],
    },
    timerClockDone: {
      color: colors.success,
    },
    hopAlertsBox: {
      padding: spacing.sm,
      borderRadius: radii.sm,
      backgroundColor: colors.surface,
      gap: 4,
    },
    hopAlertText: {
      fontSize: 12,
      color: colors.text,
    },
    timerActions: {
      flexDirection: "row",
      gap: spacing.sm,
      flexWrap: "wrap",
    },
    customTimerBox: {
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: spacing.sm,
    },
    customRow: {
      flexDirection: "row",
      gap: spacing.sm,
      flexWrap: "wrap",
    },
    customLabelField: {
      flex: 2,
      minWidth: 160,
    },
    customMinField: {
      flex: 1,
      minWidth: 110,
    },
  });
