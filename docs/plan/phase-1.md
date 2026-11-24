# Phase 1: One server

Phase 1 makes one server great for a single brewer: every calculator, a recipe builder with live stats, recipe import and export with permanent credit, and batches from brew day through aging, for beer, mead, wine and cider. Phases 1 and 2 together are the first public release.

**Exit gate:** on a clean machine, `docker compose up` → first-run setup → on the web, import a BeerXML file and a recipe from a URL (the credit shows and can't be removed) → build a beer recipe from scratch and watch its stats land inside the chosen BJCP style → start a batch from it → run brew day on a phone with mash and hop timers (alerts fire with the screen locked) → log readings and see the fermentation chart → package with the carbonation calculator and add a tasting note → start a mead batch and receive its nutrient reminders → export a recipe to BeerJSON and import it back unchanged → every calculator works in airplane mode → CI is green on `main`, including the end-to-end job.

## Order of work

Contracts land first (P1-01, P1-02); then the three lanes run in parallel. Arrows are "must merge first".

```
P1-01 schema v2 ──────┬─ P1-05 recipes API ─┬─ P1-06 batches API ── P1-13 batches + brew day (app)
P1-02 recipe content ─┤                     ├─ P1-12 recipe builder (app) ─┐
P1-03 math: recipe ───┘                     └─ P1-09 URL import ───────────┤
      stats, style fit ── P1-11 calculator screens (app)                   ├─ P1-14 import/export UI (app)
P1-04 catalog API ─────── P1-08 BeerXML/BeerJSON ──────────────────────────┘
P1-07 account hardening ── P1-15 settings, admin, About (app)
P1-10 end-to-end tests in CI (any time)
P1-16 decisions + gate check (maintainer)
```

P1-04 needs only what is on `main` today; P1-08 also needs P1-02. P1-12 needs P1-04 for the ingredient picker. P1-11 can start at once with the formulas already in brew-math and add sparge and sorbate when P1-03 lands.

| Lane       | Agent       | Tasks                                    |
| ---------- | ----------- | ---------------------------------------- |
| Core       | Claude      | P1-01, P1-02, P1-03, P1-05, P1-06, P1-07 |
| Platform   | Codex       | P1-04, P1-08, P1-09, P1-10               |
| App        | Antigravity | P1-11 to P1-15                           |
| Maintainer | You         | P1-16, all merges                        |

## Tasks

Each becomes one GitHub issue using the Task template. Every task ends with `pnpm lint && pnpm typecheck && pnpm test` passing, and merges through a PR with the required checks green.

### P1-01 Database schema v2

Lead Claude · Review Codex · Depends: none · Contract change

- [ ] Batches: status per beverage. Beer: planned → brewing → fermenting → conditioning → packaged → finished. Mead, wine, cider: planned → primary → secondary → bulk aging → stabilized → bottled → bottle aging → finished. Status history with timestamps
- [ ] Readings add Brix, titratable acidity (g/L), free SO2 (mg/L) and source (manual or device)
- [ ] `reminders` table: batch, due at, kind (nutrient, rack, sulfite, taste, ready, custom), note, done at
- [ ] Owned equipment profiles (batch size, efficiency, boil-off rate, losses), referenced by recipe versions and batches; the seed `equipment` rows stay the catalog
- [ ] Recipes add `forked_from`, plus credit `imported_at`, `license` and `public_sharing_blocked`; visibility adds `unlisted`; users add a units preference (US or metric)
- [ ] Database triggers: a recipe's credit columns can't be cleared or changed once set; recipe versions can't be updated
- [ ] Migration applies and its down file rolls back cleanly; tests for both triggers

### P1-02 Recipe content contract

Lead Claude · Review Codex · Depends: none · Contract change

- [ ] One zod schema for the JSON document stored in `recipe_versions.content`: fermentables, hops, yeasts, miscs (catalog id plus per-recipe overrides such as alpha acid), mash steps, boil additions, fermentation and aging steps, mead/wine/cider additions (honey, juice, nutrients, sulfite, acid), and target stats
- [ ] Amounts in SI only; every line works with or without a catalog id
- [ ] Published as an OpenAPI component and as a JSON Schema file that importers test against
- [ ] Fixtures: one valid recipe each for beer, mead, wine and cider, plus invalid ones

### P1-03 brew-math: recipe stats and style fit

Lead Claude · Review Codex · Depends: none

- [ ] Estimated OG from fermentables (potential SG, mash efficiency, 100% for sugars and extracts), honey and juice
- [ ] Estimated FG from yeast attenuation; ABV, total IBU at boil gravity, SRM from the same inputs
- [ ] Style fit: each stat inside, below or above a style's range
- [ ] The remaining calculators from the plan: sparge water volume, and sorbate dose for stabilizing
- [ ] Golden tests (at least 5 cases per formula, cited sources) and 100% line coverage

### P1-04 Catalog API

Lead Codex · Review Claude · Depends: none

- [ ] Search each catalog (hops, fermentables, yeasts, miscs, styles, water profiles, equipment) by name or alias, with paging; Zeus finds Columbus
- [ ] Get one item by id with its sources and licenses
- [ ] Sources and attribution endpoint for the app's About page (from `catalog.json` and `ATTRIBUTION.md`)
- [ ] Routes in the OpenAPI contract; success, validation-error and permission tests

### P1-05 Recipes API

Lead Claude · Review Codex · Depends: P1-01, P1-02, P1-03

- [ ] Create, list, search, get, delete; saving creates a new immutable version
- [ ] Stats computed by brew-math and returned with each version; style fit when a style is set
- [ ] Equipment profiles: create, edit, delete, scale a recipe to a profile
- [ ] Fork: copy to the forker's ownership with a permanent "forked from" credit
- [ ] Visibility (private, unlisted, server, public) and shares; imported recipes start private, sharing one publicly needs a confirmation flag and is refused when `public_sharing_blocked`
- [ ] Each route: success, permission-denied and validation-error tests

### P1-06 Batches API

Lead Claude · Review Codex · Depends: P1-01, P1-05

- [ ] Create a batch from a recipe version; move it through its beverage's statuses (invalid moves are refused)
- [ ] Readings: add, edit, delete, list in time order with every measurement field
- [ ] Reminders: add, list due, mark done; starting a mead batch adds its nutrient schedule from brew-math
- [ ] Notes on a batch, a recipe, or standalone; a tasting note type with free text and optional scores
- [ ] Each route: success, permission-denied and validation-error tests

### P1-07 Account hardening and settings

Lead Claude · Review Codex · Depends: P1-01

- [ ] Login and sign-up rate limiting per IP and per account
- [ ] Password reset without email: an admin creates a one-time reset link for a user
- [ ] User settings: display name, units preference, change password
- [ ] Admin: list users, disable and re-enable an account (revokes its tokens)
- [ ] Updates ADR-0010's follow-ups to say what was built

### P1-08 BeerXML and BeerJSON import and export

Lead Codex · Review Claude · Depends: P1-02, P1-04

- [ ] Parse BeerXML 1.0 and BeerJSON 1.0 into the recipe content contract, converting to SI and matching ingredients to the catalog by name and alias
- [ ] Unmatched ingredients import as free-text lines, never dropped
- [ ] Export a recipe version to both formats
- [ ] Import returns a draft for the brewer to review; nothing is saved until they confirm
- [ ] Round-trip golden fixtures (export → import gives the same content) for beer, mead, wine and cider

### P1-09 Recipe import from a URL

Lead Codex · Review Claude · Depends: P1-05, P1-08

- [ ] Fetch one page per user request; obey robots.txt; time and size limits; refuse private and local network addresses (SSRF protection)
- [ ] Structured data first: linked BeerXML or BeerJSON files, then schema.org Recipe data; per-site parsers for at most three popular brewing sites
- [ ] Copies ingredients, amounts, steps and targets; skips descriptions and photos; keeps a short excerpt and the link
- [ ] Stores source URL, site, author, import date and any stated license as permanent credit; the import starts private
- [ ] Tests use saved pages, never live sites

### P1-10 End-to-end tests in CI

Lead Codex · Review Antigravity · Depends: none

- [ ] Playwright runs against the Docker Compose stack in CI (fresh database, seeded catalog)
- [ ] Covers the web journeys: first-run setup, log in, run a calculator; recipe and batch journeys are added as P1-12 and P1-13 land
- [ ] Becomes a required check on `main`; traces uploaded on failure

### P1-11 Calculator screens

Lead Antigravity · Review Claude · Depends: P1-03 for sparge and sorbate only

- [ ] A screen for every calculator in brew-math: strike and sparge water, infusion, IBU, color, carbonation, yeast, dilution, honey and sugar, nutrients, sulfite, stabilize and backsweeten, acid, chaptalization, blending, unit converter
- [ ] Each shows its formula on tap, works offline, and respects the units preference
- [ ] When signed in, a result can be saved to a batch as a note (after P1-06)
- [ ] Component tests for input handling; screen-reader labels

### P1-12 Recipe library and builder

Lead Antigravity · Review Claude · Depends: P1-04, P1-05

- [ ] Library: list, search and filter by beverage; open, fork, delete
- [ ] Builder: ingredient picker searching the catalog (aliases included), free-text lines, mash and boil steps, mead/wine/cider additions, equipment profile, style
- [ ] Live OG, FG, ABV, IBU and color from brew-math as the brewer types, shown against the style's ranges
- [ ] Version history; visibility and sharing; credit shown on imported and forked recipes and never editable
- [ ] Playwright test: create a recipe and see its stats inside a style

### P1-13 Batches and brew day

Lead Antigravity · Review Claude · Depends: P1-06

- [ ] Batch list and detail; status changes following the beverage's flow
- [ ] Brew-day mode: step checklist from the recipe version, mash, boil and hop-addition timers that alert through local notifications with the app in the background
- [ ] Readings entry with the fields for the batch's beverage; fermentation chart of gravity and temperature over time
- [ ] Reminders shown on the batch and scheduled as local notifications; packaging step uses the carbonation calculator; notes and tasting notes
- [ ] Playwright test: start a batch, log two readings, see them on the chart

### P1-14 Import, export and brew sheet

Lead Antigravity · Review Claude · Depends: P1-08, P1-09, P1-12

- [ ] Import from a file (BeerXML, BeerJSON) or a URL into a review screen where every amount can be checked and fixed before saving
- [ ] The review screen shows the credit that will be kept
- [ ] Export a recipe to BeerXML or BeerJSON
- [ ] Printable brew sheet from the web
- [ ] Playwright test: import a BeerXML file, review, save, export

### P1-15 Settings, admin and About

Lead Antigravity · Review Claude · Depends: P1-04, P1-07

- [ ] Settings: display name, units preference (synced to the server), change password, personal API tokens
- [ ] Admin: invites, users (disable, reset link), sign-up mode shown
- [ ] About page crediting every catalog source and license, and the AGPL license with a link to the source code

### P1-16 Decisions and gate check (maintainer)

Owner: you · Depends: everything above for the gate

- [x] Decide the open questions (see Decisions below)
- [x] Open issues P1-01 to P1-15 from this file
- [x] Run the exit gate on a clean machine and on a phone; tag a pre-release image (2026-11-24, `v0.1.0-rc.1`)

## Decisions

Decided by the maintainer on 2026-11-22.

1. **Row-level security** is built in Phase 2 (ADR-0011). Phase 1 relies on `can()` and the API permission tests.
2. **Importers** live in `apps/server/src/importers/`, owned by Codex, not in a new package.
3. **Reminders** are local notifications on the phone only, with no push service. The server stores reminders; the app schedules them when it syncs.
4. **Phone apps** are Expo development and internal test builds in Phase 1. App Store and Google Play come at the first public release, after Phase 2.

## After Phase 1

Phase 2 (completes the first public release): row-level security (ADR-0011), breweries with roles, inventory with batch reservations and low-stock alerts, equipment, device integrations (iSpindel, Tilt, RAPT and others) and Brewfather import. Break it into tasks the same way once Phase 1's gate is met.
