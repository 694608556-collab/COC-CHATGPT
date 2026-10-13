import { expect, test } from '@playwright/test'
import { expandModules, swipeLeft } from './helpers'

test('左滑灰色圆角 × 仍确认删除，取消不改变场次', async ({ page }, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expandModules(page)
  const rows = page.locator('.record-list .gesture-row')
  await swipeLeft(page, rows.first())
  const remove = rows.first().locator('.swipe-delete')
  await expect(remove.locator('svg')).toBeVisible()
  expect(
    await remove.evaluate((button) => {
      const style = getComputedStyle(button)
      return {
        corners: [
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomLeftRadius,
          style.borderBottomRightRadius
        ],
        color: style.color,
        background: style.backgroundColor
      }
    })
  ).toMatchObject({ corners: ['8px', '8px', '8px', '8px'] })
  await page.screenshot({
    path: testInfo.outputPath('gray-delete-preview.png')
  })
  page.removeAllListeners('dialog')
  const confirmation = page.waitForEvent('dialog').then(async (dialog) => {
    expect(dialog.message()).toContain('安全副本')
    await dialog.dismiss()
  })
  await Promise.all([remove.click(), confirmation])
  await expect(rows).toHaveCount(4)
  await swipeLeft(page, rows.first())
  const box = (await rows.first().boundingBox())!
  await page.mouse.move(box.x + 40, box.y + 25)
  await page.mouse.down()
  await page.mouse.move(box.x + 130, box.y + 25, { steps: 8 })
  await page.mouse.up()
  await expect(remove).not.toBeVisible()
})
