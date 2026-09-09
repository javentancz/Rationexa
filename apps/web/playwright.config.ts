import { defineConfig } from "playwright/test";

const webPort = process.env.E2E_WEB_PORT ?? "3000";
const apiPort = process.env.E2E_API_PORT ?? "8000";
const webUrl = `http://localhost:${webPort}`;
const apiUrl = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: webUrl },
  webServer: [
    {
      command: "../../scripts/start-test-api.sh",
      url: `${apiUrl}/healthz`,
      reuseExistingServer: process.env.E2E_REUSE_SERVERS === "true",
      timeout: 120_000,
      env: {
        ...process.env,
        E2E_API_PORT: apiPort,
        DATABASE_URL: "sqlite:////tmp/rationexa-playwright.db",
        ARTIFACT_DIR: "/tmp/rationexa-playwright-artifacts",
        AI_PROVIDER: "deterministic",
        HOSTED_MODE: "false",
        JOB_EXECUTION_MODE: "inline",
        PUBLIC_BASE_URL: "https://intentionally-wrong-api-origin.example",
        CORS_ORIGINS: webUrl,
        SECRET_ENCRYPTION_KEY: "LVOw0rMnwHO0RjG21UEe89Y8ldVc49I2H0nJX1CPzbk=",
      },
    },
    {
      command: `npm run ${process.env.CI === "true" ? "start" : "dev"} -- --port ${webPort}`,
      url: webUrl,
      reuseExistingServer: process.env.E2E_REUSE_SERVERS === "true",
      timeout: 120_000,
      env: { ...process.env, NEXT_PUBLIC_API_URL: apiUrl },
    },
  ],
});
