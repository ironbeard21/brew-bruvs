# 0003. TypeScript monorepo with pnpm and Turborepo

- Status: Accepted
- Date: 2026-11-21

## Context

Server, app, brew math and API types must stay in step, and three agents work across them at once.

## Decision

One repository, TypeScript in strict mode everywhere, pnpm workspaces with Turborepo for tasks and caching. Biome for linting and formatting, Vitest for unit tests, Playwright for end-to-end tests. Node.js current LTS.

## Consequences

Shared code (brew math, API types, db schema) is imported directly, so a breaking change fails typecheck at once. One toolchain for every agent to learn.
