import { defineConfig, devices } from "@playwright/test";

const testPort = Number(process.env.PLAYWRIGHT_PORT || 3100);
const testBaseUrl = `http://127.0.0.1:${testPort}`;
const defaultServerCommand = process.env.PLAYWRIGHT_PRODUCTION_SERVER === "1"
  ? `PORT=${testPort} node .next/standalone/server.js`
  : `PORT=${testPort} npm run dev`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: testBaseUrl,
    trace: "on-first-retry",
    ...(process.env.PLAYWRIGHT_SPLIT === "1" ? { extraHTTPHeaders: { Origin: testBaseUrl, "x-real-ip": "127.0.0.1" } } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.PLAYWRIGHT_SERVER_COMMAND || defaultServerCommand,
    url: `${testBaseUrl}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
