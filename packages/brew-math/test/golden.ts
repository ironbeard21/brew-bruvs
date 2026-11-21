// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs golden cases from test/golden/*.json against the exported functions.
import { describe, expect, it } from "vitest";

export interface GoldenCase {
  args: unknown[];
  expected: unknown;
  tolerance: number;
  source: string;
}

type Fn = (...args: unknown[]) => unknown;

export function runGolden(fns: object, golden: Record<string, GoldenCase[]>): void {
  for (const [name, cases] of Object.entries(golden)) {
    describe(name, () => {
      const fn = (fns as Record<string, unknown>)[name];
      it("is exported", () => expect(typeof fn).toBe("function"));
      cases.forEach((c, i) => {
        it(`case ${i + 1} (${c.source})`, () => {
          let out = (fn as Fn)(...c.args);
          if (out !== null && typeof out === "object" && "ok" in out) {
            expect(out.ok).toBe(true);
            out = (out as unknown as { value: unknown }).value;
          }
          expectClose(out, c.expected, c.tolerance);
        });
      });
    });
  }
}

function expectClose(actual: unknown, expected: unknown, tolerance: number): void {
  if (typeof expected === "number") {
    expect(typeof actual).toBe("number");
    expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(tolerance);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect((actual as unknown[]).length).toBe(expected.length);
    for (const [i, e] of expected.entries()) expectClose((actual as unknown[])[i], e, tolerance);
  } else if (expected !== null && typeof expected === "object") {
    const a = actual as Record<string, unknown>;
    expect(Object.keys(a).sort()).toEqual(Object.keys(expected).sort());
    for (const [k, v] of Object.entries(expected)) expectClose(a[k], v, tolerance);
  } else {
    expect(actual).toBe(expected);
  }
}
