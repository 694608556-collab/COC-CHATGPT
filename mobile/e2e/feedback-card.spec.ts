import { acceptAppConfirmations } from './helpers'
import { expect, test } from '@playwright/test'
import { expandModules } from './helpers'

test('操作提示沿用卡片底色与细灰边，仅图标区分状态，窄屏不溢出且完成后收起', async ({ page }, info) => {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await page.getByLabel('显示鼠标手势辅助').uncheck()
  await expandModules(page)
  await page.locator('[data-drag-id="demo-long"] .record-card').click()
  const body = await page.locator('.messages').textContent()
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme)
    await page.getByRole('button', { name: '获取/刷新正文' }).click()
    const message = page.locator('.operation-feedback [role="alert"]')
    await expect(message).toContainText('仅支持 log.weizaima.com')
    expect(
      await page.locator('.navigation-dock').evaluate((node) => getComputedStyle(node).backgroundColor)
    ).toBe('rgba(0, 0, 0, 0)')
    expect(
      await message.evaluate((node) => {
        const style = getComputedStyle(node)
        const card = getComputedStyle(document.querySelector('.panel')!)
        return {
          panelBackground: style.backgroundColor === card.backgroundColor,
          neutralText: style.color === card.color,
          borderWidth: style.borderTopWidth,
          rounded: parseFloat(style.borderRadius) >= 8
        }
      })
    ).toEqual({ panelBackground: true, neutralText: true, borderWidth: '1px', rounded: true })
    await expect(message.locator('.message-symbol')).toHaveAttribute('aria-hidden', 'true')
    expect(
      await message.evaluate((node) => {
        const text = node.querySelector('.system-message-text')!.getBoundingClientRect()
        const icon = node.querySelector('.message-symbol')!.getBoundingClientRect()
        const close = node.querySelector('.message-close')!.getBoundingClientRect()
        const center = text.top + text.height / 2
        return Math.max(
          Math.abs(center - (icon.top + icon.height / 2)),
          Math.abs(center - (close.top + close.height / 2))
        )
      })
    ).toBeLessThanOrEqual(1)
    for (const width of [280, 412]) {
      await page.setViewportSize({ width, height: 915 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    }
    await page.screenshot({ path: info.outputPath(`feedback-card-${theme}.png`) })
    await expect(message).toHaveCount(0, { timeout: 5000 })
    expect(await page.locator('.messages').textContent()).toBe(body)
  }
})
