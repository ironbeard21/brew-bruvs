// SPDX-License-Identifier: AGPL-3.0-or-later
// Web: the browser's fetch. Phones use transport.native.ts.
export const platformFetch: typeof fetch = (input, init) => fetch(input, init);
