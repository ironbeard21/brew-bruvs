# 0009. Finished alcohol can never be swapped

- Status: Accepted
- Date: 2026-11-21

## Context

Selling or shipping homebrewed alcohol is restricted in the US. The swap marketplace is for ingredients, equipment and supplies.

## Decision

Finished beer, mead, wine, cider or any fermented product can never be listed, offered, traded or sold. Listing categories come only from the ingredient and equipment catalog, free text is screened, and content arriving from other servers passes the same check (`apps/server/src/services/swap-policy.ts`). No setting can turn this off. No money moves through Brew-Bruvs.

## Consequences

Simpler legal position. The policy code needs thorough tests, including against a modified remote server.
