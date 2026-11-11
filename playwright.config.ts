import { defineConfig, devices } from '@playwright/test'

// Phone-width checks against a local Hoard on a throwaway graph (e2e/serve.ts). Run `pnpm build` first.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:8799', ...devices['iPhone 13'], browserName: 'chromium' },
  webServer: { command: 'node e2e/serve.ts', url: 'http://127.0.0.1:8799/api/library', timeout: 120_000, reuseExistingServer: false },
})
