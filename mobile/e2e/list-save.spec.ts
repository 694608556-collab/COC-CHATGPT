import { expect, test } from '@playwright/test'
import { expandModules } from './helpers'

test('旧页面排序失败恢复原列表，不覆盖另一页面刚保存的数据', async ({ page, context }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expandModules(page)

  const other = await context.newPage()
  await other.goto('/')
  await other.getByRole('button', { name: '新增模组', exact: true }).click()
  await other.getByLabel('模组名称', { exact: true }).fill('另一页面新增的测试模组')
  await other.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(other.getByRole('status')).toContainText('修改已保存')

  const rows = page
    .locator('.module-group')
    .filter({ hasText: '雾港调查' })
    .locator('.record-list .gesture-row')
  await rows.first().getByRole('button', { name: '模拟拖动', exact: true }).click()
  await rows.nth(1).locator('.record-card').click()
  await expect(page.getByRole('status')).toContainText('未保存，列表已恢复')
  await expect(rows.first()).toContainText('第一场')
  await page.reload()
  await expect(page.locator('[data-module-toggle]')).toHaveCount(3)
  await expect(page.getByRole('button', { name: '模组 另一页面新增的测试模组', exact: true })).toBeVisible()
  await other.close()
})
