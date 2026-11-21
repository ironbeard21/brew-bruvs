# 0005. Hono API with a generated OpenAPI contract

- Status: Accepted
- Date: 2026-11-21

## Context

The app, outside integrations and other agents all depend on the API. Hand-written clients drift from the server.

## Decision

Routes are written with Hono and `@hono/zod-openapi`. The OpenAPI spec is generated from route definitions into `packages/api-contract`, and the app's typed client is generated from that spec (`pnpm api:generate`). The spec is the public, documented open API.

## Consequences

A server change that breaks the app fails typecheck. Integrators get a real API document. Spec changes show up clearly in PR diffs.
