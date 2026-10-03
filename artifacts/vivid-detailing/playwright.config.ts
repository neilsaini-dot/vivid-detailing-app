import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`,
    browserName: "chromium",
    viewport: { width: 390, height: 844 },
    timezoneId: "Pacific/Auckland",
    launchOptions: { args: ["--no-sandbox"] },
  },
});