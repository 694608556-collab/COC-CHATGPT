import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 412, height: 915 },
    launchOptions: { executablePath: process.env.COC_TEST_BROWSER }
  },
  webServer: {
    command: 'node scripts/dev-web.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false
  },
  workers: 1
})
