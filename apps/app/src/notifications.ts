// SPDX-License-Identifier: AGPL-3.0-or-later
// Local notifications for brew-day timers, batch reminders, and low-stock alerts (no push server, Decision 3).
import { Platform } from "react-native";
import type { Reminder } from "./api/batches";
import type { InventoryItem } from "./api/inventory";
import { formatInventoryAmount } from "./components/inventory/inventoryUnits";
import { appStorage, type KeyValueStorage } from "./state/storage";
import type { UnitSystem } from "./state/units";

const REMINDER_NOTIF_MAP_KEY = "brewbruvs.notifications.reminders";
const LOW_STOCK_ALERT_KEY = "brewbruvs.notifications.lowStock";

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

async function readLowStockMap(storage: KeyValueStorage): Promise<Record<string, number>> {
  const raw = await storage.getItem(LOW_STOCK_ALERT_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, number>;
    }
  } catch {
    // Ignore corrupt map.
  }
  return {};
}

export interface LowStockNotificationResult {
  newlyAlerted: InventoryItem[];
  permissionGranted: boolean;
  delivered: boolean;
}

/**
 * Fires a local device notification (no push service) whenever one or more inventory items
 * newly drop below their low-stock threshold or drop further since the last alert.
 * Items that are restocked above threshold are automatically cleared so future drops alert again.
 */
export async function notifyLowStockItems(
  lowStockItems: readonly InventoryItem[],
  unitSystem: UnitSystem,
  opts: {
    scopeKey?: string;
    workspaceLabel?: string;
    requestPermission?: boolean;
    storage?: KeyValueStorage;
  } = {},
): Promise<LowStockNotificationResult> {
  const storage = opts.storage ?? appStorage;
  const scopePrefix = `${opts.scopeKey ?? "me"}::`;
  const previous = await readLowStockMap(storage);
  const next: Record<string, number> = {};

  // Keep entries from other scopes intact
  for (const [k, v] of Object.entries(previous)) {
    if (!k.startsWith(scopePrefix)) {
      next[k] = v;
    }
  }

  const newlyAlerted: InventoryItem[] = [];
  for (const item of lowStockItems) {
    const key = `${scopePrefix}${item.id}`;
    const prevAvail = previous[key];
    // Alert when first crossing below threshold or dropping further below the last alerted level
    if (prevAvail === undefined || item.available < prevAvail - 1e-6) {
      newlyAlerted.push(item);
    }
    next[key] = item.available;
  }

  await storage.setItem(LOW_STOCK_ALERT_KEY, JSON.stringify(next));

  if (newlyAlerted.length === 0) {
    return { newlyAlerted: [], permissionGranted: false, delivered: false };
  }

  const prefix = opts.workspaceLabel ? `${opts.workspaceLabel} — ` : "";
  const title =
    newlyAlerted.length === 1
      ? `${prefix}Low stock: ${newlyAlerted[0]?.name ?? "Item"}`
      : `${prefix}${newlyAlerted.length} items low on stock`;
  const body =
    newlyAlerted.length === 1 && newlyAlerted[0]
      ? `${formatInventoryAmount(newlyAlerted[0].available, newlyAlerted[0].quantityUnit, unitSystem)} available${
          newlyAlerted[0].lowStockThreshold != null
            ? ` (threshold ${formatInventoryAmount(newlyAlerted[0].lowStockThreshold, newlyAlerted[0].quantityUnit, unitSystem)})`
            : ""
        }.`
      : newlyAlerted
          .slice(0, 4)
          .map(
            (i) => `${i.name} (${formatInventoryAmount(i.available, i.quantityUnit, unitSystem)})`,
          )
          .join(", ");

  if (Platform.OS === "web") {
    const granted = opts.requestPermission
      ? await requestNotificationPermission()
      : typeof window !== "undefined" &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted";
    if (granted) {
      fireWebNotification(title, body);
      return { newlyAlerted, permissionGranted: true, delivered: true };
    }
    return { newlyAlerted, permissionGranted: false, delivered: false };
  }

  const Notifications = await getNativeNotifications();
  if (!Notifications) {
    return { newlyAlerted, permissionGranted: false, delivered: false };
  }
  const granted = opts.requestPermission
    ? await requestNotificationPermission()
    : (await Notifications.getPermissionsAsync()).granted;
  if (!granted) {
    return { newlyAlerted, permissionGranted: false, delivered: false };
  }
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: null,
  });
  return { newlyAlerted, permissionGranted: true, delivered: true };
}
