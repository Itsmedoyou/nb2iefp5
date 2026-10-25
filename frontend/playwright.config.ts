import { defineConfig, devices } from "@playwright/test";

// E2E runs against the production-style server: FastAPI serving the built React app.
// Set BASE_URL to test another deployment (e.g. the docker container or the hosted app).
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  reporter: [["list"]],
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "cd ../backend && STATIC_DIR=../frontend/dist .venv/bin/uvicorn app.main:app --port 8000",
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: true,
      },
});
