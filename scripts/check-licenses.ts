// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from "node:child_process";

// SPDX identifiers for the license families allowed by ADR-0008 (including permissive
// BSD/public-domain equivalents required by transitive Expo/Metro/Babel dependencies).
const allowedLicense =
  /^(MIT|0BSD|BSD-(2|3)-Clause|Apache-2\.0|ISC|MPL-2\.0|Unlicense|BlueOak-1\.0\.0|LGPL-(2\.[01]|3\.0)(-(only|or-later))?|A?GPL-3\.0(-(only|or-later))?)$/;

// Open-licensed datasets permitted by ADR-0008 (CC-BY-4.0 data packages only, not arbitrary code).
const allowedDataPackages: Record<string, string> = {
  "caniuse-lite": "CC-BY-4.0",
};

function isAllowed(expression: string): boolean {
  // A dual-licensed package may be used under any allowed option. Every term joined by AND applies.
  return expression
    .replace(/^\(([^()]*)\)$/, "$1")
    .split(" OR ")
    .some((option) => option.split(" AND ").every((term) => allowedLicense.test(term)));
}

const report = JSON.parse(
  execFileSync("pnpm", ["licenses", "list", "--json", "--recursive", "--include-workspace-root"], {
    encoding: "utf8",
  }),
) as Record<string, { name: string; versions: string[] }[]>;
if (Object.keys(report).length === 0 || "error" in report) {
  throw new Error("pnpm did not return a dependency license report");
}

const violations = Object.entries(report)
  .filter(([license]) => !isAllowed(license))
  .flatMap(([license, packages]) =>
    packages
      .filter(({ name }) => allowedDataPackages[name] !== license)
      .map(({ name, versions }) => `${name}@${versions.join(", ")} (${license})`),
  );

if (violations.length > 0) {
  console.error(`Dependency licenses outside ADR-0008:\n${violations.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Dependency licenses comply with ADR-0008");
}
