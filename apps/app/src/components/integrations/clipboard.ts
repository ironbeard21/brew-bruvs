// SPDX-License-Identifier: AGPL-3.0-or-later
import { Platform, Share } from "react-native";

export async function copyOrShareSecret(label: string, value: string): Promise<string> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return `${label} copied to clipboard.`;
    } catch {
      return `Select and copy the ${label.toLowerCase()} above.`;
    }
  }
  try {
    await Share.share({ title: label, message: value });
    return `${label} shared.`;
  } catch {
    return `Copy the ${label.toLowerCase()} above.`;
  }
}
