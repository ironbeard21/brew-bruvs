# 0008. AGPL-3.0 code, open data only

- Status: Accepted
- Date: 2026-11-21

## Context

A community project that wants improvements to come back to everyone, funded by donations.

## Decision

- Code is AGPL-3.0-or-later. Source files carry `// SPDX-License-Identifier: AGPL-3.0-or-later`.
- Dependencies must be AGPL-compatible: MIT, BSD, Apache-2.0, ISC, MPL-2.0, LGPL, GPL-3.0 or AGPL-3.0. CI checks dependency licenses.
- Seed and community data only from open licenses (AGPL, GPL-3.0, MIT, BSD, CC0, CC-BY, CC-BY-SA), with sources and licenses kept on every row and credited in the app.
- Style guideline prose (BJCP, Brewers Association) is never imported.

## Consequences

Anyone running a modified version for others must share their changes. Some convenient dependencies or data sets are off-limits.
