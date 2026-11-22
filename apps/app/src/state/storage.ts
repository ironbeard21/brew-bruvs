// SPDX-License-Identifier: AGPL-3.0-or-later
import { Platform } from "react-native";

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const memoryStore = new Map<string, string>();

const webStorage: KeyValueStorage = {
  async getItem(key) {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch {
      // Fall back to in-memory storage when localStorage is restricted.
    }
    return memoryStore.get(key) ?? null;
  },
  async setItem(key, value) {
    memoryStore.set(key, value);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch {
      // Ignore storage quota or private-browsing errors.
    }
  },
  async removeItem(key) {
    memoryStore.delete(key);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Ignore storage errors.
    }
  },
};

const nativeStorage: KeyValueStorage = {
  async getItem(key) {
    const SecureStore = await import("expo-secure-store");
    return SecureStore.getItemAsync(key);
  },
  async setItem(key, value) {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key) {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.deleteItemAsync(key);
  },
};

export const appStorage: KeyValueStorage = Platform.OS === "web" ? webStorage : nativeStorage;
