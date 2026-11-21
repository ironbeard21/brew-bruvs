# 0006. Data model basics: Drizzle, SI units, global IDs, owners

- Status: Accepted
- Date: 2026-11-21

## Context

Data must work for beer, mead, wine and cider, move between servers later, and be shared by individuals and breweries.

## Decision

- Drizzle ORM with versioned migrations in `packages/db`.
- Store SI units and specific gravity; convert only in the UI.
- IDs are UUIDv7. Every shareable object also stores a global URI (`BASE_URL` + path) from day one, so federation needs no rewrite.
- Every recipe, batch, inventory item and note has one owner: a user or a brewery.
- Recipes and batches carry a beverage type: beer, mead, wine or cider.
- Recipe versions are immutable; batches point at a version.
- Times in UTC.

## Consequences

Sharing and permissions follow one pattern everywhere. Some UI conversion work on every screen.
