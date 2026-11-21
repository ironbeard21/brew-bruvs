// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.ts";

describe("createLogger", () => {
  it("writes one JSON line per entry with level, message and fields", () => {
    const lines: string[] = [];
    createLogger("info", (l) => lines.push(l)).info("hello", { port: 8080 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ level: "info", msg: "hello", port: 8080 });
  });

  it("drops entries below the minimum level", () => {
    const lines: string[] = [];
    const log = createLogger("warn", (l) => lines.push(l));
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines.map((l) => JSON.parse(l).msg)).toEqual(["w", "e"]);
  });
});
