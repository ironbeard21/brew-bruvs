# Phase 0: Foundations

Phase 0 builds the ground every feature stands on: the monorepo, CI, brew math, the database, the API skeleton, auth, the app shell, the catalog seed and the Docker image. Nothing user-facing beyond calculators and login.

**Exit gate:** on a clean machine, `docker compose up` → first-run admin setup in the browser → log in on web and on a phone (Expo dev build) → every Phase 0 calculator works with the phone in airplane mode → `pnpm seed` loads the catalog and the counts match `build_report.csv` → CI is green on `main`.

## Order of work

Four lanes run in parallel once P0-01 lands. Arrows are "must merge first".

```
P0-01 scaffold ─┬─ P0-02 CI
                ├─ P0-03 dev Postgres ── P0-08 schema ── P0-09 seed importer
                │                              └──────── P0-11 auth ──┐
                ├─ P0-10 server skeleton ─────────────────────────────┤
                ├─ P0-04 math: units, gravity ─┬─ P0-05 math: water, carb, yeast
                │                              ├─ P0-06 math: IBU, color
                │                              └─ P0-07 math: mead/wine/cider
                └─ P0-12 app shell (needs P0-04 for calculators, P0-11 for login)
                                                                      └─ P0-13 Docker image
P0-14 repo settings + ADR acceptance (maintainer, any time)
```

| Lane | Agent | Tasks |
| --- | --- | --- |
| Platform | Codex | P0-01, P0-02, P0-03, P0-09, P0-13 |
| Core | Claude | P0-04 to P0-08, P0-10, P0-11 |
| App | Antigravity | P0-12 |
| Maintainer | You | P0-14, all merges |

## Tasks

Each becomes one GitHub issue using the Task template. Every task ends with `pnpm lint && pnpm typecheck && pnpm test` passing.

### P0-01 Monorepo scaffold
Lead Codex · Review Claude · Depends: none
- [ ] pnpm workspaces + Turborepo with `apps/server`, `apps/app`, `packages/brew-math`, `packages/api-contract`, `packages/db`, `packages/catalog-seed` (empty packages that build)
- [ ] Shared `tsconfig` with `strict: true`; Biome config; Vitest workspace; `.nvmrc` with the current Node.js LTS
- [ ] Every command in AGENTS.md Part 4 exists (stubs may print "not implemented yet" until their task lands)
- [ ] `scripts/check-spdx.ts` fails if a `.ts`/`.tsx` file lacks the SPDX header
- [ ] `.gitignore`, `.env.example`, root `README.md` quick start
- Out of scope: any app or server code

### P0-02 CI pipeline
Lead Codex · Review Antigravity · Depends: P0-01
- [ ] GitHub Actions on every PR and on `main`: install, lint, typecheck, test, build, SPDX check
- [ ] Dependency license check with an allowlist matching ADR-0008; fails on anything else
- [ ] pnpm and Turborepo caching; full run under 10 minutes
- [ ] Coverage report; fails if `packages/brew-math` drops below 100% lines

### P0-03 Dev database
Lead Codex · Review Claude · Depends: P0-01
- [ ] `docker/compose.dev.yml` runs Postgres with a named volume
- [ ] `pnpm db:migrate` connects using `DATABASE_URL` from `.env`
- [ ] Test helper that creates a fresh database per test run and drops it after

### P0-04 brew-math: units and gravity
Lead Claude · Review Codex · Depends: P0-01
- [ ] `units`: mass, volume, temperature, gravity (SG ↔ °Plato ↔ Brix), color (SRM ↔ EBC ↔ °L), pressure; round-trip tests
- [ ] `gravity`: ABV standard and alternate, apparent and real attenuation, calories
- [ ] `hydrometer`: temperature correction
- [ ] `refractometer`: Brix → SG with wort correction factor; Terrill cubic for post-fermentation
- [ ] ≥5 golden cases per formula with cited reference values; 100% line coverage

### P0-05 brew-math: water, carbonation, yeast, dilution
Lead Claude · Review Codex · Depends: P0-04
- [ ] Strike water and infusion steps; dilution and boil-off
- [ ] Priming sugar by type with residual CO2; keg PSI for target volumes
- [ ] Yeast cells needed, packs, starter size (ale and lager rates)
- [ ] Golden tests and coverage as P0-04

### P0-06 brew-math: IBU and color
Lead Claude · Review Codex · Depends: P0-04
- [ ] IBU Tinseth and Rager, per addition and total
- [ ] Morey SRM from grain bill; display color swatch value (sRGB) for an SRM
- [ ] Golden tests and coverage as P0-04

### P0-07 brew-math: mead, wine and cider
Lead Claude · Review Codex · Depends: P0-04
- [ ] Honey or sugar to target gravity (honey potential is a parameter, default 35 PPG)
- [ ] Staggered nutrient schedule (TOSNA-style) returning doses and days
- [ ] Free SO2 target by pH; potassium metabisulfite grams
- [ ] Acid adjustment (TA), backsweetening, chaptalization, blending
- [ ] Golden tests and coverage as P0-04

### P0-08 Database schema v1
Lead Claude · Review Codex · Depends: P0-03 · Contract change
- [ ] Drizzle schema for: users, breweries, memberships (roles), catalog tables (hops, fermentables, yeasts, miscs, styles, water profiles, equipment) with `sources`, `licenses`, `aliases`, recipes, recipe versions, batches, readings, inventory items, equipment items, notes, shares
- [ ] UUIDv7 ids; `uri` column on shareable tables; `beverage` enum (beer, mead, wine, cider); owner = user or brewery
- [ ] First migration applies to an empty database and rolls back cleanly
- [ ] Out of scope: swap and federation tables (later phases)

### P0-09 Catalog seed importer
Lead Codex · Review Claude · Depends: P0-08
- [ ] Seed data and `build/build_catalog.py` (already in `packages/catalog-seed` from the starter kit) stay unchanged; add `src/import.ts`
- [ ] `pnpm seed` upserts by `id`; a second run changes nothing
- [ ] Row counts match `build_report.csv`; spot-check test from that package's AGENTS.md passes
- [ ] Aliases searchable (Zeus finds Columbus)

### P0-10 Server skeleton
Lead Claude · Review Codex · Depends: P0-01
- [ ] Hono app with `config.ts` (zod-validated env), logger, error format `{ error: { code, message } }`
- [ ] `GET /healthz` and `GET /api/openapi.json`; `pnpm api:generate` writes types and client into `packages/api-contract`
- [ ] Permission helper `can(user, action, resource)` with unit tests for owner, brewery role, share and visibility
- [ ] Serves a static web build from a configured folder

### P0-11 Authentication
Lead Claude · Review Codex · Depends: P0-08, P0-10 · Decides ADR-0010
- [ ] First-run setup creates the admin; afterwards setup is closed
- [ ] Email/password sign-up (open or invite-only by env var), login, logout
- [ ] Revocable app tokens for phones; personal API tokens with scopes
- [ ] Optional OIDC login, on when its env vars are set
- [ ] Tests: success, wrong password, revoked token, invite-only blocks sign-up
- [ ] PR updates ADR-0010 to Accepted with the library chosen and why

### P0-12 App shell
Lead Antigravity · Review Claude · Depends: P0-01, P0-04 (calculators), P0-11 (login)
- [ ] Expo Router app that runs on web, iOS simulator and Android emulator
- [ ] First-launch server-address screen; login through the generated client; switch server
- [ ] Calculators screen for P0-04's calculators, working offline; US/metric toggle
- [ ] Screen-reader labels; works at phone and desktop widths
- [ ] Playwright test on web: connect, log in, run ABV calculator
- [ ] PR includes web and mobile screenshots

### P0-13 Production Docker image
Lead Codex · Review Antigravity · Depends: P0-10, P0-12
- [ ] Multi-stage Dockerfile building server + web app into one image; runs as non-root
- [ ] Multi-arch build (amd64, arm64) pushed to GitHub Container Registry on tags
- [ ] `docker/compose.yml` (app + Postgres) matches the plan doc's example; migrations run on start
- [ ] CI job: build image, start compose, hit `/healthz`, complete first-run setup

### P0-14 Repo settings and decisions (maintainer)
Owner: you · Depends: none
- [ ] Create the GitHub organization and `brew-bruvs` repo; add the AGPL-3.0 license via GitHub's license picker
- [ ] Protect `main`: require CI and one review; only you can merge
- [ ] Read ADRs 0001-0009 and confirm them; ADR-0010 is accepted through P0-11
- [ ] Open issues P0-01 to P0-13 from this file

## After Phase 0

Phase 1 (one server, first public release with Phase 2): recipe builder with live stats and style checks, BeerXML/BeerJSON import and export, recipe import from URLs with permanent credit, batches with readings and brew-day timers, notes, the rest of the calculator screens, mead/wine/cider aging stages and reminders. Break it into tasks the same way once Phase 0's gate is met.
