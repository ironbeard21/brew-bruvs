// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const BASE_URL = externalBaseURL ?? `http://127.0.0.1:${PORT}`;

const serverCommand = process.env.DATABASE_URL
  ? `PORT=${PORT} BASE_URL=${BASE_URL} WEB_DIR=./dist node ../server/src/index.ts`
  : `PORT=${PORT} WEB_DIR=./dist node e2e/server.ts`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  reporter: "list",
  workers: 1,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      ...(externalBaseURL ? { dependencies: ["desktop"] } : {}),
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
  ...(externalBaseURL
    ? {}
    : {
        webServer: {
          command: serverCommand,
          url: `${BASE_URL}/healthz`,
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
      }),
});
