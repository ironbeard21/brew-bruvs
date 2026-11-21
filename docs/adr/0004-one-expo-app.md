# 0004. One Expo app for iOS, Android and web

- Status: Accepted
- Date: 2026-11-21

## Context

Brewers use phones on brew day and computers for recipe work. The project can't maintain several front ends.

## Decision

One Expo (React Native) app with Expo Router builds for iOS, Android and web. The server serves the web build. Phone apps ask for a server address on first launch and connect to any Brew-Bruvs server. Calculators are bundled and work offline. The maintainer owns the Apple and Google developer accounts; builds go through EAS.

## Consequences

One UI codebase. Some web-only polish is harder than with a pure web framework. App store review applies to mobile releases.
