import { test, expect } from '@playwright/test'
import { expandModules } from './helpers'

test('鼠标按住超过长按阈值后仍可向左拖动显示删除', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expandModules(page)
  const row = page.locator('.record-list .gesture-row').first()
  await row.scrollIntoViewIfNeeded()
  const box = (await row.boundingBox())!
  const x = box.x + box.width * 0.65,
    y = box.y + 25
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.waitForTimeout(600)
  await page.mouse.move(x - 85, y, { steps: 8 })
  await page.mouse.up()
  await expect(row.locator('.swipe-delete')).toBeVisible()
  await expect(page.locator('.selection-check')).toHaveCount(0)
})

test('浏览器辅助入口可模拟长按、左滑和点击目标排序，并可关闭', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expandModules(page)
  const group = page.locator('.module-group').first()
  const rows = group.locator('.record-list .gesture-row')
  await rows.first().getByRole('button', { name: '模拟长按', exact: true }).click()
  await expect(rows.first().locator('input[type="checkbox"]')).toBeChecked()
  await group.getByRole('button', { name: '退出多选', exact: true }).click()
  await rows.first().getByRole('button', { name: '模拟左滑', exact: true }).click()
  await expect(rows.first().locator('.swipe-delete')).toBeVisible()
  await rows.first().screenshot({ path: 'test-results/browser-gesture-helper.png' })
  await rows.first().locator('.record-card').click()
  await expect(rows.first().locator('.swipe-delete')).toBeHidden()
  await rows.first().getByRole('button', { name: '模拟拖动', exact: true }).click()
  await expect(page.locator('.dev-banner [role="status"]')).toContainText('点击同一列表')
  await rows.last().locator('.record-card').click()
  await expect(rows.first()).toContainText('第二场')
  await expect(page.locator('.dev-banner [role="status"]')).toHaveCount(0)
  await page.getByLabel('显示鼠标手势辅助').uncheck()
  await expect(page.getByRole('button', { name: '模拟左滑', exact: true })).toHaveCount(0)
})
