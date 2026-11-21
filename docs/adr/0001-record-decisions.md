# 0001. Record architecture decisions as ADRs

- Status: Accepted
- Date: 2026-11-21

## Context

Three AI agents (Codex, Claude, Antigravity) build this project in parallel. Without a written record they re-argue settled choices or quietly contradict each other.

## Decision

Every architecture decision gets a short ADR in `docs/adr/`, numbered in order, using `0000-template.md`. Agents read ADRs before starting work and never edit an accepted ADR; a change is a new ADR that supersedes the old one, approved by the maintainer.

## Consequences

Decisions are easy to find and cite in PRs. Changing direction takes one small extra file.
