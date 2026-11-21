# 0002. Self-hosted: one app container plus Postgres

- Status: Accepted
- Date: 2026-11-21

## Context

Brew-Bruvs is a community project with no company running a central service. Each person or brewery runs their own server, like Mealie.

## Decision

Ship one multi-arch Docker image (amd64, arm64) containing the API, the web build of the app and background jobs, run next to a Postgres container with Docker Compose. Configuration comes only from environment variables. Background jobs use a Postgres-backed queue, so there is no Redis.

## Consequences

Install is `docker compose up`. Runs on a NAS, home server or Raspberry Pi. Postgres is required even for one brewer; a SQLite mode can come later as its own ADR.
