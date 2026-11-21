# AGENTS.md — apps/app

Adds to the root `AGENTS.md`. Lead: Antigravity. Reviewer: Claude.

One Expo app for iOS, Android and the web. The web build is served by the server container.

## Rules

- Expo Router for navigation; screens in `app/`, shared components in `src/components/`, API hooks in `src/api/`.
- Talk to the server only through the generated client from `packages/api-contract` wrapped in TanStack Query hooks. No hand-written fetch calls.
- First launch asks for the server address (like Immich or Home Assistant). Store it with the session; support switching servers.
- Calculators work with no server and no network: they import `packages/brew-math` directly.
- Brew-day timers and reminders must keep working when the app is in the background (local notifications).
- Show values in the user's chosen units (US by default); convert with `packages/brew-math/units`. Never store converted values.
- Every screen works at phone width and desktop width, and with screen readers (labels on all inputs and buttons).
- Swap screens never offer finished beer, mead, wine or cider as a category.

## Tests

- Component tests with Vitest + React Native Testing Library for anything with logic.
- Playwright tests on the web build for core journeys (connect to server, log in, run a calculator, create a recipe).
- Before opening a PR, check the screen on web and on one mobile simulator, and attach screenshots of both.
