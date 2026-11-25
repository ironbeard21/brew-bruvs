// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from "node:child_process";

const tag = process.argv[2];
const versionTag =
  /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
if (!tag || !versionTag.test(tag)) throw new Error("Expected a release tag such as v1.0.0");

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const previous = git("tag", "--merged", tag, "--sort=-version:refname")
  .split("\n")
  .find((candidate) => candidate !== tag && versionTag.test(candidate));
const range = previous ? `${previous}..${tag}` : tag;
const topics = new Map<string, string[]>([
  ["Breaking changes", []],
  ["Features", []],
  ["Fixes", []],
  ["Performance", []],
  ["Other changes", []],
]);

for (const subject of git("log", "--no-merges", "--format=%s", range).split("\n")) {
  const match = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/.exec(subject);
  if (!match) continue;
  const [, type, scope, breaking, description] = match;
  const topic = breaking
    ? "Breaking changes"
    : type === "feat"
      ? "Features"
      : type === "fix" || type === "revert"
        ? "Fixes"
        : type === "perf"
          ? "Performance"
          : "Other changes";
  topics.get(topic)?.push(`- ${scope ? `**${scope}** ` : ""}${description}`);
}

console.log(`# Brew-Bruvs ${tag.slice(1)}`);
for (const [topic, entries] of topics) {
  if (entries.length) console.log(`\n## ${topic}\n\n${entries.join("\n")}`);
}
if (previous) console.log(`\nChanges since \`${previous}\`.`);
