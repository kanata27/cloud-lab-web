import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8787",
    locale: "ru-RU",
    viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ["--no-sandbox", "--disable-dev-shm-usage"] }
      : {},
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:8787",
    timeout: 90000,
    reuseExistingServer: false,
    env: { WRANGLER_SEND_METRICS: "false" },
  },
});
