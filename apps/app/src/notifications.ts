// SPDX-License-Identifier: AGPL-3.0-or-later
// Local notifications for brew-day timers and batch reminders (no push server, Decision 3).
import { Platform } from "react-native";
import type { Reminder } from "./api/batches";
import { appStorage } from "./state/storage";

const REMINDER_NOTIF_MAP_KEY = "brewbruvs.notifications.reminders";

let nativeConfigured = false;

async function getNativeNotifications() {
  if (Platform.OS === "web") return null;
  const Notifications = await import("expo-notifications");
  if (!nativeConfigured) {
    nativeConfigured = true;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("brew-timers", {
        name: "Brew-Day Timers & Reminders",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
  }
  return Notifications;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined" || typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    try {
      const res = await Notification.requestPermission();
      return res === "granted";
    } catch {
      return false;
    }
  }

  const Notifications = await getNativeNotifications();
  if (!Notifications) return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export function fireWebNotification(title: string, body: string): void {
  if (Platform.OS !== "web") return;
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    // Ignore browser notification restrictions.
  }
}

/**
 * Schedules a local notification that fires at `triggerAtMs` even when the phone screen is locked.
 * Returns the platform notification id (or null on web / when permission is denied).
 */
export async function scheduleTimerNotification(opts: {
  title: string;
  body: string;
  triggerAtMs: number;
}): Promise<string | null> {
  const seconds = Math.max(1, Math.round((opts.triggerAtMs - Date.now()) / 1000));
  if (Platform.OS === "web") {
    return null;
  }
  const granted = await requestNotificationPermission();
  if (!granted) return null;
  const Notifications = await getNativeNotifications();
  if (!Notifications) return null;

  return Notifications.scheduleNotificationAsync({
    content: {
      title: opts.title,
      body: opts.body,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
    },
  });
}

export async function cancelLocalNotification(id: string | null | undefined): Promise<void> {
  if (!id || Platform.OS === "web") return;
  const Notifications = await getNativeNotifications();
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already fired or removed.
  }
}

async function readReminderMap(): Promise<Record<string, string>> {
  const raw = await appStorage.getItem(REMINDER_NOTIF_MAP_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, string>;
    }
  } catch {
    // Ignore corrupt map.
  }
  return {};
}

async function writeReminderMap(map: Record<string, string>): Promise<void> {
  await appStorage.setItem(REMINDER_NOTIF_MAP_KEY, JSON.stringify(map));
}

export async function cancelReminderNotification(reminderId: string): Promise<void> {
  const map = await readReminderMap();
  const notifId = map[reminderId];
  if (notifId) {
    await cancelLocalNotification(notifId);
    delete map[reminderId];
    await writeReminderMap(map);
  }
}

/**
 * Syncs a list of batch reminders into local device notifications:
 * cancels completed reminders and schedules upcoming undone reminders.
 */
export async function syncReminderNotifications(
  reminders: Reminder[],
): Promise<{ scheduled: number; permissionGranted: boolean }> {
  if (Platform.OS === "web") {
    return { scheduled: 0, permissionGranted: false };
  }
  const granted = await requestNotificationPermission();
  if (!granted) {
    return { scheduled: 0, permissionGranted: false };
  }
  const Notifications = await getNativeNotifications();
  if (!Notifications) {
    return { scheduled: 0, permissionGranted: false };
  }

  const map = await readReminderMap();
  const now = Date.now();
  let scheduled = 0;

  for (const r of reminders) {
    const existingId = map[r.id];
    const dueMs = Date.parse(r.dueAt);

    if (r.doneAt || !Number.isFinite(dueMs) || dueMs <= now) {
      if (existingId) {
        await cancelLocalNotification(existingId);
        delete map[r.id];
      }
      continue;
    }

    if (existingId) {
      scheduled += 1;
      continue;
    }

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `${r.batchName}: ${r.kind} reminder`,
        body: r.note || `Time for ${r.kind} on ${r.batchName}.`,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(dueMs),
      },
    });
    map[r.id] = id;
    scheduled += 1;
  }

  await writeReminderMap(map);
  return { scheduled, permissionGranted: true };
}
