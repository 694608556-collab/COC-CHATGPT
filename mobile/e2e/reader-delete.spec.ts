import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expandModules } from './helpers'

/** @param page - 独立浏览器上下文。 @returns 公开样本导入并展开后的页面，无返回值。 */
async function ready(page: Page) {
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
  await expandModules(page)
}

test('批量删除是多选区最后一个按钮，窄宽屏均紧跟其他操作而非独占最右端', async ({ page }, info) => {
  await ready(page)
  const group = page.locator('.module-group').filter({ hasText: '雾港调查' })
  await group.getByRole('button', { name: '全选此模组', exact: true }).click()
  const actions = group.getByRole('group', { name: '雾港调查（公开测试）操作', exact: true })
  await expect(actions.getByRole('button').last()).toHaveText('批量删除')
  for (const width of [412, 1000]) {
    await page.setViewportSize({ width, height: 915 })
    const previous = (await actions.getByRole('button', { name: '合成导出', exact: true }).boundingBox())!
    const deletion = (await actions.getByRole('button', { name: '批量删除', exact: true }).boundingBox())!
    const first = (await actions.getByRole('button').first().boundingBox())!
    if (Math.abs(previous.y - deletion.y) < 2)
      expect(deletion.x - (previous.x + previous.width)).toBeLessThanOrEqual(12)
    else expect(Math.abs(deletion.x - first.x)).toBeLessThanOrEqual(2)
    await actions.screenshot({ path: info.outputPath(`batch-delete-${width}.png`) })
  }
})

for (const index of [0, 1]) {
  test(`${index === 0 ? '在线' : '手动'}场次详情删除：取消保留正文，确认仅删除当前场次并返回，重开保持`, async ({
    page
  }, info) => {
    await ready(page)
    const group = page.locator('.module-group').filter({ hasText: '雾港调查' })
    const row = group.locator('.record-card').nth(index)
    const name = (await row.locator('.record-name').textContent())!
    await row.click()
    await expect(page.locator('.messages')).toBeVisible()
    const body = await page.locator('.messages').textContent()
    const buttons = page.locator('.reader-actions + .entity-actions').getByRole('button')
    await expect(buttons.last()).toHaveText('删除场次')
    if (index === 0) await expect(buttons.nth(1)).toHaveText('重置链接状态')
    await page.screenshot({ path: info.outputPath(`reader-delete-${index}.png`) })
    await page.getByRole('button', { name: '删除场次', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: '确认操作', exact: true })
    await expect(confirm).toContainText('删除此场次及已保存正文')
    await confirm.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    await expect(page.locator('.messages')).toHaveText(body!)
    await page.getByRole('button', { name: '删除场次', exact: true }).click()
    await confirm.getByRole('button', { name: '确认', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('操作已保存')
    await expect(page.getByRole('button', { name: '编辑场次', exact: true })).toHaveCount(0)
    await expandModules(page)
    await expect(page.locator('.record-list .record-card')).toHaveCount(3)
    await expect(group.locator('.record-card')).toHaveCount(1)
    await page.getByRole('button', { name: '刷新测试文件列表' }).click()
    await expect(page.getByText('测试文件（0）', { exact: true })).toBeVisible()
    await page.reload()
    await expandModules(page)
    await expect(page.locator('.record-list .record-card')).toHaveCount(3)
    await expect(page.locator('.record-name').filter({ hasText: name })).toHaveCount(0)
  })
}

test('详情页删除遇到陈旧版本时保留正文，不覆盖另一页刚保存的数据', async ({ page, context }) => {
  await ready(page)
  const card = page.locator('.record-list .record-card').first()
  const name = (await card.locator('.record-name').textContent())!
  await card.click()
  await expect(page.locator('.messages')).toBeVisible()
  const body = await page.locator('.messages').textContent()
  const other = await context.newPage()
  await other.goto('/')
  await other.locator('[data-module-toggle]').first().dblclick()
  await other.getByLabel('模组名称', { exact: true }).fill('另一页已保存的公开模组')
  await other.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(other.locator('.editor')).toHaveCount(0)
  await page.getByRole('button', { name: '删除场次', exact: true }).click()
  await page
    .getByRole('dialog', { name: '确认操作', exact: true })
    .getByRole('button', { name: '确认', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText('未保存，列表已恢复')
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.locator('.messages')).toHaveText(body!)
  await page.reload()
  await expandModules(page)
  await expect(page.locator('.record-list .record-card')).toHaveCount(4)
  await expect(page.getByRole('button', { name: '模组 另一页已保存的公开模组', exact: true })).toBeVisible()
  await other.close()
})
