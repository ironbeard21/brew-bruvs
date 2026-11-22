// SPDX-License-Identifier: AGPL-3.0-or-later
// Authentication contract hooks.
// P0-11 adds /api/auth/status, /api/setup, /api/auth/login, /api/auth/signup,
// /api/auth/logout, and /api/me to @brew-bruvs/api-contract. Until P0-11 merges,
// this module defines the UI boundary without any hand-written fetch calls.

export interface AuthUser {
  id: string;
  uri: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export interface AuthStatus {
  setupNeeded: boolean;
  signupMode: "open" | "invite";
  oidcEnabled: boolean;
}

/** True once P0-11 auth routes are present in @brew-bruvs/api-contract. */
export const AUTH_CONTRACT_AVAILABLE = false;
