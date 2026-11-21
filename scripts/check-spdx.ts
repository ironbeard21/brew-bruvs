// SPDX-License-Identifier: AGPL-3.0-or-later
// Fails if a TypeScript source file in apps/ or packages/ doesn't start with the SPDX header.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const HEADER = "// SPDX-License-Identifier: AGPL-3.0-or-later";
const SKIP = new Set(["node_modules", "dist", "coverage", ".expo", ".turbo", "generated"]);

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

const files = ["apps", "packages", "scripts"].flatMap((d) => walk(d, []));
const missing = files.filter((f) => !readFileSync(f, "utf8").startsWith(HEADER));

if (missing.length > 0) {
  console.error(`Missing SPDX header in ${missing.length} file(s):\n${missing.join("\n")}`);
  process.exit(1);
}
console.log(`SPDX headers OK (${files.length} files)`);
