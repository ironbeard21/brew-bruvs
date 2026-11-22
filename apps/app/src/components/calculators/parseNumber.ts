// SPDX-License-Identifier: AGPL-3.0-or-later

export function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatFixed(value: number, digits: number): string {
  return value.toFixed(digits);
}
