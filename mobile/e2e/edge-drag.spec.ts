import { acceptAppConfirmations } from './helpers'
import { test, expect } from '@playwright/test'
import { expandModules } from './helpers'

test('手柄拖到屏幕边缘自动滚动，松开后停止', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expandModules(page)
  const row = page.locator('.record-list .gesture-row').first()
  await row.scrollIntoViewIfNeeded()
  const box = (await row.getByRole('button', { name: /拖动排序/ }).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const before = await page.evaluate(() => scrollY)
  await page.mouse.move(box.x + box.width / 2, 650, { steps: 5 })
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 20)
  await page.mouse.up()
  const after = await page.evaluate(() => scrollY)
  await page.waitForTimeout(150)
  expect(await page.evaluate(() => scrollY)).toBe(after)
  await expect(page.locator('.gesture-row.drag, .drop-target')).toHaveCount(0)
})
