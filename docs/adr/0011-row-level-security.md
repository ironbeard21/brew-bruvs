# 0011. Row-level security in Postgres, built in Phase 2

- Status: Accepted
- Date: 2026-11-22

## Context

The product plan asks for permissions enforced in the database as well as the API, so a bug in one layer can't leak private recipes. Today every route checks access through one helper, `can(user, action, resource)` (owner → brewery role → explicit share → visibility), and each route has a permission-denied test. In Phase 1 a server mostly holds one brewer's data; Phase 2 brings breweries with many members, which is where a missed check would expose other people's work.

## Decision

Enforce read and write access with Postgres row-level security on every owned table (recipes, recipe versions, batches, readings, reminders, notes, inventory, equipment, shares), mirroring `can()`. The server connects as a role without `BYPASSRLS` and sets the signed-in user and their brewery memberships per transaction; jobs and migrations use a separate role. Built in Phase 2 as its own task. Phase 1 keeps `can()` and the API permission tests as the only layer.

## Consequences

Two layers must agree, so Phase 2 adds tests that run the same permission cases through the API and directly against the database. Every database call in a request runs inside a transaction that sets the user. New owned tables added in Phase 1 must keep the owner columns and checks used today so the policies can be written without schema changes.
