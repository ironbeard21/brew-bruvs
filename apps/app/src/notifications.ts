// SPDX-License-Identifier: AGPL-3.0-or-later
// Local notifications for brew-day timers, batch reminders, and low-stock alerts (no push server, Decision 3).
import { Platform } from "react-native";
import { fetchDueReminders, type Reminder } from "./api/batches";
import type { InventoryItem } from "./api/inventory";
import { formatInventoryAmount } from "./components/inventory/inventoryUnits";
import { appStorage, type KeyValueStorage } from "./state/storage";
import type { UnitSystem } from "./state/units";

const REMINDER_NOTIF_MAP_KEY = "brewbruvs.notifications.reminders";
const LOW_STOCK_ALERT_KEY = "brewbruvs.notifications.lowStock";
/** Horizon ahead of now when fetching reminders to schedule locally on app open (90 days). */
export const REMINDER_SYNC_HORIZON_MS = 90 * 24 * 60 * 60 * 1000;
/** Cap scheduled native reminders below iOS's 64-notification ceiling so brew-day timers fit too. */
export const MAX_SCHEDULED_REMINDERS = 48;

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

export function fireWebNotification(title: string, body: string): boolean {
  if (Platform.OS !== "web") return false;
  if (typeof window === "undefined" || typeof Notification === "undefined") return false;
  if (Notification.permission !== "granted") return false;
  try {
    new Notification(title, { body });
    return true;
  } catch {
    // Ignore browser notification restrictions.
    return false;
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

interface StoredReminderEntry {
  notifId?: string;
  dueAt?: string;
  notifiedDue?: boolean;
}

export interface NativeReminderAdapter {
  getPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<boolean>;
  scheduleAt: (opts: { title: string; body: string; date: Date }) => Promise<string>;
  fireNow: (opts: { title: string; body: string }) => Promise<string>;
  cancel: (id: string) => Promise<void>;
}

export interface SyncRemindersOptions {
  scopeKey?: string;
  pruneMissing?: boolean;
  requestPermission?: boolean;
  storage?: KeyValueStorage;
  nowMs?: number;
  nativeAdapter?: NativeReminderAdapter | null;
}

export interface SyncRemindersResult {
  scheduled: number;
  dueAlerted: number;
  pruned: number;
  permissionGranted: boolean;
}

async function defaultNativeAdapter(): Promise<NativeReminderAdapter | null> {
  const Notifications = await getNativeNotifications();
  if (!Notifications) return null;
  return {
    getPermissionGranted: async () => (await Notifications.getPermissionsAsync()).granted,
    requestPermission: async () => {
      const current = await Notifications.getPermissionsAsync();
      if (current.granted) return true;
      return (await Notifications.requestPermissionsAsync()).granted;
    },
    scheduleAt: async ({ title, body, date }) =>
      Notifications.scheduleNotificationAsync({
        content: { title, body, sound: true },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date,
        },
      }),
    fireNow: async ({ title, body }) =>
      Notifications.scheduleNotificationAsync({
        content: { title, body, sound: true },
        trigger: null,
      }),
    cancel: async (id) => {
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
      } catch {
        // Already fired or removed.
      }
    },
  };
}

async function readReminderMap(
  storage: KeyValueStorage = appStorage,
): Promise<Record<string, StoredReminderEntry>> {
  const raw = await storage.getItem(REMINDER_NOTIF_MAP_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const normalized: Record<string, StoredReminderEntry> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") {
          normalized[k] = { notifId: v };
        } else if (v && typeof v === "object") {
          normalized[k] = v as StoredReminderEntry;
        }
      }
      return normalized;
    }
  } catch {
    // Ignore corrupt map.
  }
  return {};
}

async function writeReminderMap(
  map: Record<string, StoredReminderEntry>,
  storage: KeyValueStorage = appStorage,
): Promise<void> {
  await storage.setItem(REMINDER_NOTIF_MAP_KEY, JSON.stringify(map));
}

export async function cancelReminderNotification(
  reminderId: string,
  opts: { storage?: KeyValueStorage; nativeAdapter?: NativeReminderAdapter | null } = {},
): Promise<void> {
  const storage = opts.storage ?? appStorage;
  const map = await readReminderMap(storage);
  const matchingKeys = Object.keys(map).filter(
    (k) => k === reminderId || k.endsWith(`::${reminderId}`),
  );
  if (matchingKeys.length === 0) return;

  const adapter =
    opts.nativeAdapter !== undefined ? opts.nativeAdapter : await defaultNativeAdapter();

  for (const key of matchingKeys) {
    const notifId = map[key]?.notifId;
    if (notifId) {
      if (adapter) {
        await adapter.cancel(notifId);
      } else {
        await cancelLocalNotification(notifId);
      }
    }
    delete map[key];
  }
  await writeReminderMap(map, storage);
}

function reminderNotificationCopy(r: Reminder, overdue: boolean): { title: string; body: string } {
  return {
    title: overdue
      ? `${r.batchName}: ${r.kind} reminder due`
      : `${r.batchName}: ${r.kind} reminder`,
    body: r.note || `Time for ${r.kind} on ${r.batchName}.`,
  };
}

/**
 * Syncs reminders into local device notifications (no push server):
 * - Cancels completed reminders (and, when `pruneMissing` is true, reminders removed/completed on other devices)
 * - Schedules upcoming undone reminders (capped at MAX_SCHEDULED_REMINDERS soonest)
 * - Fires a deduplicated local alert for open reminders already due
 */
export async function syncReminderNotifications(
  reminders: readonly Reminder[],
  opts: SyncRemindersOptions = {},
): Promise<SyncRemindersResult> {
  const storage = opts.storage ?? appStorage;
  const now = opts.nowMs ?? Date.now();
  const scopePrefix = opts.scopeKey ? `${opts.scopeKey}::` : "";
  const keyFor = (id: string) => `${scopePrefix}${id}`;
  const adapter =
    opts.nativeAdapter !== undefined ? opts.nativeAdapter : await defaultNativeAdapter();

  const map = await readReminderMap(storage);
  let dirty = false;
  let pruned = 0;

  // 1. Prune stale reminders in this scope when performing a full app-open sync.
  const incomingIds = new Set(reminders.map((r) => r.id));
  if (opts.pruneMissing) {
    for (const key of Object.keys(map)) {
      const inScope = scopePrefix ? key.startsWith(scopePrefix) : !key.includes("::");
      if (!inScope) continue;
      const reminderId = scopePrefix ? key.slice(scopePrefix.length) : key;
      if (!incomingIds.has(reminderId)) {
        const notifId = map[key]?.notifId;
        if (notifId && adapter) {
          await adapter.cancel(notifId);
        }
        delete map[key];
        pruned += 1;
        dirty = true;
      }
    }
  }

  // 2. Separate completed, overdue/due-now, and upcoming open reminders.
  const openDue: Reminder[] = [];
  const openUpcoming: { reminder: Reminder; dueMs: number }[] = [];

  for (const r of reminders) {
    const key = keyFor(r.id);
    const existing = map[key];
    const dueMs = Date.parse(r.dueAt);

    if (r.doneAt || !Number.isFinite(dueMs)) {
      if (existing) {
        if (existing.notifId && adapter) {
          await adapter.cancel(existing.notifId);
        }
        delete map[key];
        pruned += 1;
        dirty = true;
      }
      continue;
    }

    if (dueMs <= now) {
      openDue.push(r);
    } else {
      openUpcoming.push({ reminder: r, dueMs });
    }
  }

  openUpcoming.sort((a, b) => a.dueMs - b.dueMs);
  const cappedUpcoming = openUpcoming.slice(0, MAX_SCHEDULED_REMINDERS);

  // Never prompt for OS permissions when there are no open reminders to deliver/schedule.
  const hasActionable = openDue.length > 0 || (adapter !== null && cappedUpcoming.length > 0);
  if (!hasActionable) {
    if (dirty) await writeReminderMap(map, storage);
    return { scheduled: 0, dueAlerted: 0, pruned, permissionGranted: false };
  }

  const shouldRequest = opts.requestPermission ?? true;
  let permissionGranted = false;
  if (adapter) {
    permissionGranted = shouldRequest
      ? await adapter.requestPermission()
      : await adapter.getPermissionGranted();
  } else if (Platform.OS === "web") {
    permissionGranted =
      typeof window !== "undefined" &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted";
  }

  if (!permissionGranted) {
    if (dirty) await writeReminderMap(map, storage);
    return { scheduled: 0, dueAlerted: 0, pruned, permissionGranted: false };
  }

  let dueAlerted = 0;
  for (const r of openDue) {
    const key = keyFor(r.id);
    const existing = map[key];
    if (existing?.notifiedDue && existing.dueAt === r.dueAt) {
      continue;
    }
    if (existing?.notifId && adapter) {
      await adapter.cancel(existing.notifId);
    }
    const copy = reminderNotificationCopy(r, true);
    let delivered = false;
    if (adapter) {
      await adapter.fireNow(copy);
      delivered = true;
    } else if (Platform.OS === "web") {
      delivered = fireWebNotification(copy.title, copy.body);
    }
    if (delivered) {
      map[key] = { dueAt: r.dueAt, notifiedDue: true };
      dueAlerted += 1;
      dirty = true;
    }
  }

  let scheduled = 0;
  if (adapter) {
    for (const { reminder: r, dueMs } of cappedUpcoming) {
      const key = keyFor(r.id);
      const existing = map[key];
      if (existing?.notifId && existing.dueAt === r.dueAt) {
        scheduled += 1;
        continue;
      }
      if (existing?.notifId) {
        await adapter.cancel(existing.notifId);
      }
      const copy = reminderNotificationCopy(r, false);
      const notifId = await adapter.scheduleAt({
        title: copy.title,
        body: copy.body,
        date: new Date(dueMs),
      });
      map[key] = { notifId, dueAt: r.dueAt, notifiedDue: false };
      scheduled += 1;
      dirty = true;
    }
  }

  if (dirty) {
    await writeReminderMap(map, storage);
  }

  return { scheduled, dueAlerted, pruned, permissionGranted: true };
}

export interface SyncDueRemindersOnOpenResult extends SyncRemindersResult {
  fetched: number;
}

/**
 * Fetches all open reminders due through the upcoming horizon from GET /api/reminders and syncs
 * them into local notifications, pruning any reminders that were completed or deleted elsewhere.
 */
export async function syncDueRemindersOnOpen(opts: {
  serverUrl: string;
  authToken: string | null;
  userId: string;
  horizonMs?: number;
  nowMs?: number;
  requestPermission?: boolean;
  storage?: KeyValueStorage;
  nativeAdapter?: NativeReminderAdapter | null;
  customFetch?: typeof fetch;
}): Promise<SyncDueRemindersOnOpenResult> {
  const now = opts.nowMs ?? Date.now();
  const untilIso = new Date(now + (opts.horizonMs ?? REMINDER_SYNC_HORIZON_MS)).toISOString();
  const reminders = await fetchDueReminders(
    opts.serverUrl,
    opts.authToken,
    untilIso,
    opts.customFetch,
  );
  const result = await syncReminderNotifications(reminders, {
    scopeKey: `${opts.serverUrl}::${opts.userId}`,
    pruneMissing: true,
    nowMs: now,
    ...(opts.requestPermission !== undefined ? { requestPermission: opts.requestPermission } : {}),
    ...(opts.storage ? { storage: opts.storage } : {}),
    ...(opts.nativeAdapter !== undefined ? { nativeAdapter: opts.nativeAdapter } : {}),
  });
  return { fetched: reminders.length, ...result };
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
 * newly drop below their low-stock threshold or drop further since the last delivered alert.
 * Deduplication state is only written after OS/browser notification delivery succeeds, so
 * pending alerts fire once notification permission is granted. Restocked items are pruned.
 */
export async function notifyLowStockItems(
  lowStockItems: readonly InventoryItem[],
  unitSystem: UnitSystem,
  opts: {
    scopeKey?: string;
    workspaceLabel?: string;
    requestPermission?: boolean;
    force?: boolean;
    storage?: KeyValueStorage;
  } = {},
): Promise<LowStockNotificationResult> {
  const storage = opts.storage ?? appStorage;
  const scopePrefix = `${opts.scopeKey ?? "me"}::`;
  const previous = await readLowStockMap(storage);
  const currentIds = new Set(lowStockItems.map((i) => i.id));
  const pruned: Record<string, number> = {};
  let prunedAny = false;

  // Keep entries from other scopes and still-low items in this scope; prune restocked items.
  for (const [k, v] of Object.entries(previous)) {
    if (!k.startsWith(scopePrefix)) {
      pruned[k] = v;
      continue;
    }
    const itemId = k.slice(scopePrefix.length);
    if (currentIds.has(itemId)) {
      pruned[k] = v;
    } else {
      prunedAny = true;
    }
  }

  const newlyAlerted: InventoryItem[] = [];
  for (const item of lowStockItems) {
    const key = `${scopePrefix}${item.id}`;
    const prevAvail = previous[key];
    // Alert when forced (manual check), first crossing below threshold, or dropping further.
    if (opts.force || prevAvail === undefined || item.available < prevAvail - 1e-6) {
      newlyAlerted.push(item);
    }
  }

  if (newlyAlerted.length === 0) {
    if (prunedAny) {
      await storage.setItem(LOW_STOCK_ALERT_KEY, JSON.stringify(pruned));
    }
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

  let permissionGranted = false;
  let delivered = false;

  if (Platform.OS === "web") {
    permissionGranted = opts.requestPermission
      ? await requestNotificationPermission()
      : typeof window !== "undefined" &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted";
    if (permissionGranted) {
      delivered = fireWebNotification(title, body);
    }
  } else {
    const Notifications = await getNativeNotifications();
    if (Notifications) {
      permissionGranted = opts.requestPermission
        ? await requestNotificationPermission()
        : (await Notifications.getPermissionsAsync()).granted;
      if (permissionGranted) {
        await Notifications.scheduleNotificationAsync({
          content: { title, body, sound: true },
          trigger: null,
        });
        delivered = true;
      }
    }
  }

  if (delivered) {
    for (const item of newlyAlerted) {
      pruned[`${scopePrefix}${item.id}`] = item.available;
    }
    await storage.setItem(LOW_STOCK_ALERT_KEY, JSON.stringify(pruned));
  } else if (prunedAny) {
    await storage.setItem(LOW_STOCK_ALERT_KEY, JSON.stringify(pruned));
  }

  return { newlyAlerted, permissionGranted, delivered };
}
