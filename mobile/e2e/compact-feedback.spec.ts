import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { expandModules } from './helpers'

async function ready(page: Page) {
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await page.getByLabel('显示鼠标手势辅助').uncheck()
  await expandModules(page)
}

async function fades(page: Page, message: Locator) {
  await message.evaluate((node) => {
    const state = window as Window & { observedFadeAfter?: number }
    state.observedFadeAfter = undefined
    const start = performance.now()
    const observer = new MutationObserver(() => {
      if (node.classList.contains('fading')) {
        state.observedFadeAfter = performance.now() - start
        observer.disconnect()
      }
    })
    observer.observe(node, { attributes: true, attributeFilter: ['class'] })
  })
  await expect
    .poll(() => page.evaluate(() => (window as Window & { observedFadeAfter?: number }).observedFadeAfter), {
      timeout: 5000,
      intervals: [50]
    })
    .toBeGreaterThan(2500)
  await expect(message).toHaveCount(0)
}

test('正文保存标签在日期栏末尾，不再独占一栏；窄屏无溢出', async ({ page }, info) => {
  await page.setViewportSize({ width: 430, height: 915 })
  await ready(page)
  const row = page.locator('[data-drag-id="demo-manual"]')
  await expect(row.locator('.record-meta')).toHaveCount(0)
  await expect(row.locator('.record-status > :last-child')).toHaveText('正文已保存')
  await expect(row.locator('.record-status-text')).toContainText('跑团时间：2026-10-13')
  const text = (await row.locator('.record-status-text').boundingBox())!
  const badge = (await row.locator('.tag').boundingBox())!
  expect(badge.x).toBeGreaterThanOrEqual(text.x + text.width)
  await row.evaluate((node) => node.scrollIntoView({ block: 'center' }))
  await row.screenshot({ path: info.outputPath('compact-record-date-badge.png') })
  await expect(page.locator('[data-drag-id="demo-missing"] .record-status > :last-child')).toHaveText(
    '缺少正文'
  )
  for (const width of [280, 320, 360, 393, 412, 430, 600, 840]) {
    await page.setViewportSize({ width, height: 915 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  }
})

test('海豹链接校验错误和缺正文警告三秒渐隐；可重复显示和手动关闭，正文不变', async ({ page }) => {
  await ready(page)
  await page.locator('[data-drag-id="demo-long"] .record-card').click()
  const body = await page.locator('.messages').textContent()
  await page.getByRole('button', { name: '获取/刷新正文' }).click()
  const error = page.locator('.operation-feedback [role="alert"]')
  await expect(error).toContainText('仅支持 log.weizaima.com')
  await fades(page, error)
  expect(await page.locator('.messages').textContent()).toBe(body)
  await page.getByRole('button', { name: '获取/刷新正文' }).click()
  await expect(error).toContainText('仅支持 log.weizaima.com')
  await error.getByRole('button', { name: '关闭错误提示' }).click()
  await expect(error).toHaveCount(0)
  expect(await page.locator('.messages').textContent()).toBe(body)
  await page.getByRole('button', { name: '返回场次', exact: true }).click()
  await expandModules(page)
  await page.locator('[data-drag-id="demo-missing"] .record-card').click()
  const warning = page.locator('.system-message.warning')
  await expect(warning).toContainText('此场次尚未保存正文')
  await fades(page, warning)
  await expect(page.getByRole('button', { name: '获取/刷新正文' })).toBeEnabled()
})
