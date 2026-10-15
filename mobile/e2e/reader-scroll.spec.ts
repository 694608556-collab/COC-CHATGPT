import { expect, test } from '@playwright/test'
import { expandModules } from './helpers'

test('滚动列表后打开及再次打开场次均从详情顶部开始，正文阅读和分页不强制回顶', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
  // 重开后走按需读取正文入口；第二次打开覆盖本轮已读正文复用入口。
  await page.reload()
  for (let visit = 0; visit < 2; visit++) {
    await expandModules(page)
    const row = page.getByRole('button', { name: /雾港调查.*第一场：灯塔线索/ })
    await row.scrollIntoViewIfNeeded()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)
    await row.click()
    await expect(page.getByRole('button', { name: '编辑场次', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await page.mouse.wheel(0, 650)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200)
    await page.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(page.getByLabel('正文分页')).toContainText('2 / 3')
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200)
    await page.getByRole('button', { name: '返回场次', exact: true }).click()
  }
})
