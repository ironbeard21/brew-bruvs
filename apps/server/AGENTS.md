# AGENTS.md — apps/server

Adds to the root `AGENTS.md`. Lead: Claude. Reviewer: Codex.

The server is one container: the open API, the web build of the app, background jobs and (from Phase 3) federation.

## Structure

```
src/
  index.ts          start-up: config, db, routes, jobs
  config.ts         reads and validates env vars (zod); nothing else reads process.env
  routes/<area>.ts  one file per API area; handlers stay thin
  services/<area>.ts business logic; the only place that touches the db
  auth/             sessions, local accounts, OIDC
  jobs/             Postgres-backed background jobs
  federation/       Phase 3 only
```

## Rules

- Routes are defined with `@hono/zod-openapi` so the OpenAPI spec in `packages/api-contract` is generated from code. Run `pnpm api:generate` after route changes and commit the result.
- Every route checks permissions through one helper (`can(user, action, resource)`): owner → brewery role → explicit share → visibility. No ad-hoc checks in handlers.
- Database access only through `packages/db` and only in `services/`.
- Validate every request body and query with zod. Return errors as `{ error: { code, message } }`.
- Times are stored and returned in UTC ISO-8601. IDs are UUIDv7; shareable objects also store a global URI built from `BASE_URL`.
- Calculations call `packages/brew-math`; never inline a formula.
- Swap listings and offers go through `services/swap-policy.ts`, which enforces the no-alcohol rule. Its tests must cover local and incoming federated content.
- Log with the shared logger; never log tokens, passwords, emails or addresses.

## Tests

- Unit tests for services with Vitest.
- API tests against a real Postgres started by `docker/compose.dev.yml` (no database mocks).
- Each new route: one success test, one permission-denied test, one validation-error test.
