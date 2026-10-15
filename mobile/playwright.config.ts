import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 412, height: 915 }
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI
  },
  workers: 1
})
