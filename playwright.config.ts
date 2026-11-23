import { randomBytes, scryptSync } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const origin = "http://127.0.0.1:3100";
const database = "http://127.0.0.1:54329";
const password = process.env.SUA_E2E_PASSWORD ??= randomBytes(24).toString("hex");
const databaseKey = process.env.SUA_E2E_DATABASE_KEY ??= randomBytes(24).toString("hex");
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64);
const channel = process.env.SUA_E2E_BROWSER_CHANNEL;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  outputDir: "fix/test-results",
  workers: 1,
  use: { ...devices["Desktop Chrome"], baseURL: origin, channel, trace: "retain-on-failure" },
  webServer: [
    { command: "node tests/supabase-fixture.mjs", url: `${database}/health`, env: { SUA_E2E_DATABASE_KEY: databaseKey } },
    {
      command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
      url: `${origin}/login`, timeout: 90_000,
      env: {
        APP_ORIGIN: origin, SUPABASE_URL: database, SUPABASE_SECRET_KEY: databaseKey,
        ADMIN_USERNAME: "e2e-admin", ADMIN_PASSWORD_HASH: `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`,
        SESSION_SECRET: randomBytes(32).toString("hex"), DEVICE_MODE: "mock", MOCK_FEEDER_FAILURE: "0",
      },
    },
  ],
});
