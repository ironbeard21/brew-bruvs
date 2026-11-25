# Brew-Bruvs

Free, open-source, self-hosted software for making beer, mead, wine and cider: brewing calculators, recipes, batch tracking, inventory, group breweries, and swapping ingredients between linked servers.

Status: Phase 0 (foundations). See `docs/plan/phase-0.md`.

License: AGPL-3.0-or-later.

## For AI agents and contributors

Read `AGENTS.md` first. It holds the working rules, hard rules, repo map, commands and workflow for everyone.

| Tool               | How it gets the rules                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Claude Code        | `CLAUDE.md` imports `AGENTS.md` (`@AGENTS.md`)                                                                            |
| OpenAI Codex       | Reads `AGENTS.md` at the root and in each folder                                                                          |
| Google Antigravity | Reads `AGENTS.md` (v1.20.3 and later). Turn on Settings → Agent → "Load nested AGENTS.md files" so folder rules apply too |

Keep every `AGENTS.md` under 10,000 characters: Antigravity limits rule files to 12,000. Put long reference material in `docs/` and link to it.

Decisions live in `docs/adr/`. Product and phase plans live in `docs/plan/`.

## Development database

Copy `.env.example` to `.env` and keep the PostgreSQL password in `DATABASE_URL` and
`POSTGRES_PASSWORD` in sync. From the repository root, run:

```sh
docker compose -f docker/compose.dev.yml up -d --wait
pnpm db:migrate
```

Postgres listens on `127.0.0.1:5432` and keeps its data in the `postgres-dev` volume.
`pnpm db:migrate` applies pending migrations. To include the PostgreSQL integration tests in
`pnpm test`, set `TEST_DATABASE_URL` in your shell to a connection whose role can create databases.

## Run with Docker

See the [install, upgrade, and backup guide](docs/install.md).
