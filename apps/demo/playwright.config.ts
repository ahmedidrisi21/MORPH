import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Use a preinstalled Chromium when present (CI images, sandboxes); otherwise Playwright's own.
const localChromium = process.env.PW_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const executablePath = existsSync(localChromium) ? localChromium : undefined;
const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "off",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    // No keys: the demo must work on replay + rules (I9).
    command: `pnpm exec next dev -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { MORPH_PROVIDER: "replay", TYPESAFE_API_KEY: "", MORPH_NARRATIVE_PROVIDER: "none" },
  },
});
