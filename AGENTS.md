# AGENTS.md

Rules for every AI agent working in this repo (Codex, Claude, Antigravity). This file is the single source of truth: `CLAUDE.md` imports it, and Codex and Antigravity read it directly. Folders with their own `AGENTS.md` add rules for that area; they never override this file.

Brew-Bruvs is free, AGPL-licensed, self-hosted software for making beer, mead, wine and cider: brewing calculators, recipes, batch tracking, inventory, group breweries, and swapping ingredients between linked servers. Product plan: `docs/plan/`. Decisions: `docs/adr/`.

## Part 1. How to work

Behavioral guidelines to reduce common LLM coding mistakes.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Part 2. Hard rules (never break these)

1. **No finished alcohol in swaps.** Beer, mead, wine, cider or any fermented product can never be listed, offered, traded or sold. Enforce it in the swap code and on content arriving from other servers, with tests. Never add a setting that turns this off.
2. **Brew math lives only in `packages/brew-math`.** Apps and server import it; never re-implement a formula elsewhere. Every formula has golden tests.
3. **Store SI, convert at the edges.** Database and APIs use kg, L, °C, specific gravity; the UI converts to the user's units. US units are the UI default.
4. **License.** Code is AGPL-3.0-or-later; new source files start with `// SPDX-License-Identifier: AGPL-3.0-or-later`. New dependencies must have an AGPL-compatible license (MIT, BSD, Apache-2.0, ISC, MPL-2.0, LGPL, GPL-3.0, AGPL-3.0) and be justified in the PR.
5. **Data provenance.** Catalog rows keep their `sources` and `licenses`. Only open-licensed data. Imported recipes keep their credit (source URL, site, author) and it can never be removed.
6. **Privacy.** Locations are city/state only. Shipping addresses are never federated, logged or exposed in public APIs.
7. **Federation is off by default.** Server-to-server linking only happens after an admin turns it on and enters servers by hand.
8. **No secrets in the repo.** Config comes from environment variables; `.env` files are git-ignored; add new variables to `.env.example`.
9. **Contracts first.** Change the database schema, OpenAPI spec or federation schemas only in a PR that says so in its title. Don't edit generated code by hand.
10. **Don't edit this file or `docs/adr/`** unless the issue asks for it. Propose changes in the PR description instead.

## Part 3. Repo map

```
apps/server/            Hono API + web UI host + jobs + federation (later)
apps/app/               Expo app: iOS, Android, web
packages/brew-math/     All calculators, pure TypeScript, no dependencies
packages/api-contract/  OpenAPI spec + generated types and client
packages/db/            Drizzle schema + migrations
packages/catalog-seed/  Seed ingredient/style data + importer
docs/plan/              Product and phase plans
docs/adr/               Architecture decision records
docker/                 Dockerfile, compose files
```

Stack: TypeScript (strict) everywhere, Node.js LTS, pnpm workspaces + Turborepo, Hono, Drizzle + Postgres, Expo + Expo Router, Vitest, Playwright, Biome. Federation later via Fedify.

## Part 4. Commands

These are the contract. If one doesn't exist yet, the scaffold issue creates it; don't invent alternatives.

| Command | Does |
| --- | --- |
| `pnpm install` | Install everything |
| `pnpm dev` | Run server + app in dev mode |
| `pnpm lint` / `pnpm format` | Biome check / fix |
| `pnpm typecheck` | TypeScript across the workspace |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:e2e` | End-to-end tests (Playwright) |
| `pnpm db:generate` / `pnpm db:migrate` | Create / apply migrations |
| `pnpm api:generate` | Regenerate API types from the OpenAPI spec |
| `pnpm seed` | Load the catalog seed into the database |
| `docker compose -f docker/compose.dev.yml up` | Postgres for local dev |

Before saying a task is done, run `pnpm lint && pnpm typecheck && pnpm test` and report the result.

## Part 5. Workflow

- **One issue, one branch, one PR.** Branch: `<agent>/<issue-number>-<short-slug>` (e.g. `codex/12-ci-pipeline`). Agent names: `claude`, `codex`, `antigravity`.
- **Start with a plan** in the PR description: steps, each with how it will be verified (Part 1, rule 4).
- **Stay in scope.** Only files the issue needs. Found something else? Note it under "Follow-ups" in the PR.
- **Commits:** Conventional Commits (`feat(brew-math): add Tinseth IBU`).
- **Tests come with the change.** Bug fixes start with a failing test.
- **Review:** a different agent reviews every PR (see owners below). The human maintainer is the only one who merges.
- **Stuck or unsure:** stop and ask in the issue. Don't guess at product decisions.

| Area | Lead | Reviewer |
| --- | --- | --- |
| `packages/brew-math` | Claude | Codex |
| `apps/server`, `packages/db`, `packages/api-contract`, federation | Claude | Codex |
| `apps/app` (mobile + web UI) | Antigravity | Claude |
| Integrations, importers, `packages/catalog-seed` | Codex | Claude |
| Tests, CI, Docker | Codex | Antigravity |
