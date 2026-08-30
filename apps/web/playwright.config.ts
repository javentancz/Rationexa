import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://localhost:3000" },
  webServer: [
    {
      command: "../../scripts/start-test-api.sh",
      url: "http://127.0.0.1:8000/healthz",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        ...process.env,
        DATABASE_URL: "sqlite:////tmp/rationexa-playwright.db",
        ARTIFACT_DIR: "/tmp/rationexa-playwright-artifacts",
        AI_PROVIDER: "deterministic",
        HOSTED_MODE: "false",
        JOB_EXECUTION_MODE: "inline",
        PUBLIC_BASE_URL: "https://intentionally-wrong-api-origin.example",
        CORS_ORIGINS: "http://localhost:3000",
        SECRET_ENCRYPTION_KEY: "LVOw0rMnwHO0RjG21UEe89Y8ldVc49I2H0nJX1CPzbk=",
      },
    },
    {
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
      env: { ...process.env, NEXT_PUBLIC_API_URL: "http://127.0.0.1:8000" },
    },
  ],
});
