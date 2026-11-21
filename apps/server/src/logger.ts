// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared logger: one JSON object per line. Never pass tokens, passwords, emails or addresses.
export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type Logger = Record<LogLevel, (msg: string, fields?: Record<string, unknown>) => void>;

export function createLogger(
  minLevel: LogLevel,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Logger {
  const log = (level: LogLevel) => (msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    write(JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }));
  };
  return { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") };
}
