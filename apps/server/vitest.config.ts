// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Postgres tests sign users up, and password hashing is slow on purpose; 5 s is too tight on CI.
    testTimeout: 30_000,
  },
});
