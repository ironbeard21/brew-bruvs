# 0007. Federation over ActivityPub, off by default

- Status: Accepted
- Date: 2026-11-21

## Context

Servers need to share recipes, profiles and swap listings without a central company.

## Decision

Use ActivityPub through the Fedify library (Phase 3). Users and breweries are actors; recipes, listings and ratings are objects; follows and swap offers are activities. Linking is off on every new install; an admin turns it on and enters other servers' addresses by hand. The maintainer's server runs hub mode. There is no automatic server directory for now.

## Consequences

Interoperates with a proven protocol. Each admin chooses who to link with. Discovery is manual until a directory is decided in a later ADR.
