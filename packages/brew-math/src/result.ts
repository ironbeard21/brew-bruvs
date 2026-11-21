// SPDX-License-Identifier: AGPL-3.0-or-later

/** Calculators return a result instead of throwing, so the UI can show a helpful message. */
export type CalcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: "out_of_range" | "invalid_input"; message: string } };

export const ok = <T>(value: T): CalcResult<T> => ({ ok: true, value });

export const fail = <T>(
  message: string,
  code: "out_of_range" | "invalid_input" = "out_of_range",
): CalcResult<T> => ({ ok: false, error: { code, message } });

/** Returns a message when `value` is outside [min, max], otherwise null. */
export function outside(name: string, value: number, min: number, max: number): string | null {
  if (!Number.isFinite(value)) return `${name} must be a number`;
  if (value < min || value > max) return `${name} must be between ${min} and ${max}`;
  return null;
}
