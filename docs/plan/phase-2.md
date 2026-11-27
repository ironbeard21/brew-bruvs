# Phase 2: Breweries

Phase 2 turns one brewer's server into one that friends share. It adds breweries with roles, shared inventory that batches reserve and use up, equipment, readings from hydrometer devices, Brewfather import, and permissions enforced in the database too. Phases 1 and 2 together are the first public release, so Phase 2 also makes the server and the phone apps ready to hand to strangers.

Phase 2 starts once P1-16 is done: the Phase 1 gate walked on a clean machine and a phone, and a pre-release image tagged.

**Exit gate:** on a clean machine, start the release image with `docker compose up` → the admin creates a brewery and invites a friend as Brewer and another as Member → the Brewer builds a brewery recipe and starts a batch; its ingredients are reserved from the brewery's inventory and the shopping list shows what's short → the Member logs a reading and a note but can't edit the recipe → an iSpindel (or a script posting its real payload) sends readings that appear on the chart → packaging uses up the reserved ingredients and a low-stock alert fires → a batch event reaches a webhook receiver → import a recipe and a batch from Brewfather → a direct database query as the app's role can't see another user's private recipe → back up the server, restore it onto a fresh machine, and everything is there → upgrade a server running the Phase 1 pre-release image and nothing is lost → iOS and Android release builds pass TestFlight and Play internal testing → CI is green on `main`, including the end-to-end job.

## Order of work

The schema lands first (P2-01); then the three lanes run in parallel. Arrows are "must merge first".

```
P2-01 schema v3 ─┬─ P2-02 row-level security
                 ├─ P2-03 breweries API ──────┬─ P2-11 breweries (app)
                 │                            └─ P2-13 sharing, equipment, activity (app)
                 ├─ P2-04 inventory API ──────── P2-12 inventory + shopping list (app)
                 ├─ P2-05 equipment API ──────── P2-13
                 ├─ P2-06 sharing + activity ─── P2-13
                 ├─ P2-07 device readings ──┬─── P2-14 integrations (app)
                 ├─ P2-08 webhooks out ─────┤
                 └─ P2-09 Brewfather import ┘
P2-10 release readiness (any time)
P2-15 store-ready app builds (any time)
P2-16 end-to-end journeys (as screens land)
P2-17 decisions + gate check + 1.0 (maintainer)
```

P2-02 goes last in the Core lane because its policies have to mirror every route the other Core tasks add. P2-03 to P2-06 can then land in any order.

| Lane       | Agent       | Tasks                                    |
| ---------- | ----------- | ---------------------------------------- |
| Core       | Claude      | P2-01, P2-03, P2-04, P2-06, then P2-02   |
| Platform   | Codex       | P2-05, P2-07, P2-08, P2-09, P2-10, P2-16 |
| App        | Antigravity | P2-11 to P2-15                           |
| Maintainer | You         | P2-17, all merges                        |

Reviews follow AGENTS.md: Codex reviews Core, Claude reviews Platform importers and integrations plus the App lane, and Antigravity reviews tests, CI and Docker.

## Tasks

Each becomes one GitHub issue using the Task template. Every task ends with `pnpm lint && pnpm typecheck && pnpm test` passing, and merges through a PR with the required checks green. Reviews are posted on the PR with `gh pr review --comment`.

### P2-01 Database schema v3

Lead Claude · Review Codex · Depends: P1-16 · Contract change

- [x] Brewery roles become Owner, Brewer, Member, Viewer (Decision 1). Breweries get a description
- [x] Inventory items add lot, location, alpha acid (hops), purchased on, a low-stock threshold, and a tradeable flag and quantity (unused until swaps, Phase 4)
- [x] `inventory_reservations`: batch, inventory item, quantity, state (reserved, used, released)
- [x] Equipment items add type, condition, and held by (a user)
- [x] `integrations`: owner, kind (ispindel, tilt, rapt, webhook_out, …), name, config, secret token hash, linked batch, last seen
- [x] `activity_events`: actor, brewery, verb, object type and id, at
- [x] `shareable_type` adds inventory and equipment where missing; equipment profiles become shareable
- [x] Migration applies, and its down file rolls back cleanly

### P2-02 Row-level security

Lead Claude · Review Codex · Depends: P2-01, P2-03 to P2-06 · Contract change · ADR-0011

- [x] Postgres policies on every owned table, mirroring `can()`: owner → brewery role → share → visibility
- [x] The server connects as a role without `BYPASSRLS` and sets the signed-in user and their memberships per transaction; migrations and jobs use a separate role
- [x] Parity tests run the same permission cases through the API and straight against the database
- [x] Docker Compose and `.env.example` gain the second database role; the upgrade path for existing installs is documented

### P2-03 Breweries API

Lead Claude · Review Codex · Depends: P2-01

- [x] Create, rename and delete a brewery; list your breweries
- [x] Invite by email or one-time code (same server), accept, leave, remove a member, change roles, transfer ownership (a brewery always has an owner)
- [x] Recipes, batches, notes and equipment profiles can be created as the brewery's, or moved from you to a brewery you can write to
- [x] Members can log readings and notes on brewery batches but can't edit recipes or batches. This adds a "contribute" action to `can()`
- [x] Each route: success, permission-denied and validation-error tests, with one case per role

### P2-04 Inventory API

Lead Claude · Review Codex · Depends: P2-01

- [x] Items: add, edit, delete, list, search; personal or brewery-owned; stored in SI (kg, L, each)
- [x] Starting a batch reserves its ingredients from the batch owner's inventory, matched by catalog id and then by name. It reports what's short instead of refusing to start
- [x] Packaging (beer) or bottling (mead, wine, cider) uses up the reservations; deleting the batch or undoing the move releases them
- [x] Low-stock list (below threshold), and a shopping list: shortfalls of planned batches plus items below threshold
- [x] Hop alpha acid from inventory can override the recipe's in a batch's stats (brew-math recalculates; nothing is computed outside it)

### P2-05 Equipment API

Lead Codex · Review Claude · Depends: P2-01

- [x] Equipment items: add, edit, delete, list; personal or brewery-owned; can start from a catalog row
- [x] Lending inside a brewery: "held by" a member, with history in the activity feed
- [x] Each route: success, permission-denied and validation-error tests

### P2-06 Sharing and activity

Lead Claude · Review Codex · Depends: P2-01

- [x] Visibility and share routes for batches, notes, inventory, equipment and equipment profiles, like recipes have (Phase 1 follow-up)
- [x] Activity feed per brewery: batch started and moved, reading logged, inventory used, member joined, item lent; paged, newest first
- [x] Only members see a brewery's feed

### P2-07 Device readings

Lead Codex · Review Claude · Depends: P2-01

- [x] An integration gives the brewer a URL with a secret token. Devices post to it with no user session. Tokens are stored hashed and can be revoked and rotated
- [x] Payload parsers for iSpindel and GravityMon, Tilt (through TiltBridge and TiltPi) and RAPT. Readings land on the linked batch with source `device`
- [x] Conversions (Plato to SG, °F to °C, gravity correction) come from brew-math only
- [x] Rate limit per token, payload size limit; tests use recorded real payloads

### P2-08 Webhooks out

Lead Codex · Review Claude · Depends: P2-01

- [x] Send batch events (status moves, readings, reminders due) to URLs a user adds, signed with HMAC-SHA256
- [x] Retries with backoff, then marked failing; a test-send button
- [x] The same public-address checks as URL import (no private or local addresses, re-checked on every delivery)

### P2-09 Brewfather import

Lead Codex · Review Claude · Depends: P2-01, P2-04

- [x] With the user's own Brewfather API key, import recipes, batches (with readings) and inventory. Recipes become drafts to review, as in P1-08
- [x] The key is used for that import only and never stored or logged
- [x] Recipe credit is kept when Brewfather records an outside source; unmatched ingredients import as free text
- [x] Tests use recorded API responses, never the live service

### P2-10 Release readiness

Lead Codex · Review Antigravity · Depends: none

- [x] Backups: a documented `pg_dump` backup and restore, with a CI test that restores a backup into a fresh database
- [x] Upgrades: CI starts the Phase 1 pre-release image with data, upgrades to the new image, and checks nothing was lost
- [x] Images tagged by version (`1.0.0`, `1.0`, `latest`); release notes from Conventional Commits
- [x] `SOURCE_URL` setting (defaults to the upstream repo), shown on the About page, so a modified server links to its own source as the AGPL requires
- [x] Install, upgrade and backup guide in `docs/`; security headers reviewed
- [x] Phase 1 leftover: `generate.py` produces the `ppgToPotentialSg` golden cases

### P2-11 Breweries (app)

Lead Antigravity · Review Claude · Depends: P2-03

- [x] Create a brewery, invite members, accept invites, change roles, leave, transfer ownership
- [x] Switch between "me" and a brewery; recipes, batches and inventory show who owns them
- [x] Controls hide what your role can't do; the server still refuses it

### P2-12 Inventory and shopping list (app)

Lead Antigravity · Review Claude · Depends: P2-04

- [x] Inventory list and editor in the user's units; scan-friendly search
- [x] Starting a batch shows what gets reserved and what's short
- [x] Shopping list; low-stock alerts as local notifications (no push service, as in Phase 1)

### P2-13 Sharing, equipment and activity (app)

Lead Antigravity · Review Claude · Depends: P2-05, P2-06

- [x] One share dialog for recipes, batches, notes, inventory and equipment: visibility, plus people and breweries with read or edit
- [x] Equipment list with "held by" and lending
- [x] Brewery activity feed

### P2-14 Integrations (app)

Lead Antigravity · Review Claude · Depends: P2-07, P2-08, P2-09

- [x] Add a device: pick the kind, link a batch, copy its URL and token, see the last reading arrive
- [x] Webhooks: add, test-send, see failures
- [x] Brewfather import with draft review

### P2-15 Store-ready app builds

Lead Antigravity · Review Claude · Depends: none

- [x] EAS build profiles for TestFlight and Play internal testing; icons, splash, store listing text and screenshots
- [x] Privacy policy (no tracking, data stays on the user's server) linked in the app and the listings
- [x] Phase 1 leftovers: native file picker for imports, and syncing all due reminders when the app opens

### P2-16 End-to-end journeys

Lead Codex · Review Antigravity · Depends: screens as they land

- [x] Playwright with two and three users: brewery invite and roles, Member limits, reservations and the shopping list, a device payload reaching the chart, a webhook reaching a test receiver
- [x] Backup-and-restore and upgrade jobs from P2-10 are required checks on `main`

### P2-17 Decisions, gate check and 1.0 (maintainer)

Owner: you · Depends: everything above for the gate

- [x] Decide the open questions (see Decisions below)
- [x] Open issues P2-01 to P2-16 from this file
- [ ] Run the exit gate; submit the apps to the stores; tag `1.0.0`

## Decisions

Decided by the maintainer on 2026-11-22.

1. **Brewery roles** are the product plan's: Owner, Brewer, Member and Viewer, replacing Phase 0's owner, admin, brewer and viewer. A brewery can have more than one Owner. A new "contribute" action lets a Member log readings and notes on brewery batches without editing recipes or batches. No breweries exist yet, so nothing needs migrating.
2. **Large-brewery features** (sub-teams, a shared brew calendar, equipment booking, moderation) come after the first release. Phase 2 has lending ("held by") and the activity feed.
3. **Devices** in Phase 2: iSpindel and GravityMon, Tilt through TiltBridge and TiltPi, and RAPT. Fermentrack and BrewPi-style controllers come later.
4. **Ratings, comments and "I brewed this"** come in Phase 3, with linking, where they matter across servers.
5. **Short ingredients at batch start:** the batch starts anyway, and what's missing goes on the shopping list.
6. **Brewfather API key:** used once for the import and never stored or logged.

## After Phase 2

Phase 3 links servers over ActivityPub (ADR-0007): instances, remote users and breweries, follows, public recipes travelling with their credit, remote brewery members, ratings and comments. Linking stays off until an admin turns it on and enters servers by hand. Phase 4 is the swap marketplace over that link, built on Phase 2's inventory, with finished alcohol blocked (ADR-0009).
