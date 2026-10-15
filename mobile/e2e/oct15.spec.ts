import { expect, test } from '@playwright/test'
import { acceptAppConfirmations, expandModules } from './helpers'

test('角色资料两排三列、技能编辑至少三列，折叠标题无默认焦点框', async ({ page }, info) => {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: '新建七版角色' }).click()
  await page.getByLabel('姓名', { exact: true }).fill('公开布局角色')
  await page.getByText('技能', { exact: true }).click()
  const skills = page.locator('.skill-edit-row')
  const first = (await skills.nth(0).boundingBox())!
  const third = (await skills.nth(2).boundingBox())!
  expect(third.y).toBe(first.y)
  for (const text of ['技能', '武器战斗表']) {
    const summary = page.locator('summary').filter({ hasText: text })
    await summary.focus()
    expect(await summary.evaluate((n) => getComputedStyle(n).outlineWidth)).toBe('0px')
  }
  await page.screenshot({ path: info.outputPath('skills-three-columns.png') })
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await page.locator('.record-card').click()
  const fields = page.locator('.character-basic > div')
  await expect(fields).toHaveCount(6)
  expect(await fields.locator('dt').allTextContents()).toEqual([
    '姓名',
    '年龄',
    '职业',
    '性别',
    '出生地',
    '居住地'
  ])
  const boxes = await fields.evaluateAll((nodes) =>
    nodes.map((n) => {
      const b = n.getBoundingClientRect()
      return { y: b.y, x: b.x }
    })
  )
  expect(boxes[0]!.y).toBe(boxes[2]!.y)
  expect(boxes[3]!.y).toBe(boxes[5]!.y)
  expect(boxes[3]!.y).toBeGreaterThan(boxes[0]!.y)
  await page.screenshot({ path: info.outputPath('basic-two-rows.png') })
})

test('错误提示图文居中、正文操作排间距缩紧，版本说明沿用桌面内容', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expandModules(page)
  await page.locator('[data-drag-id="demo-long"] .record-card').click()
  const first = (await page.getByRole('button', { name: '返回场次', exact: true }).boundingBox())!
  const second = (await page.getByRole('button', { name: '获取/刷新正文', exact: true }).boundingBox())!
  expect(second.y - (first.y + first.height)).toBeLessThanOrEqual(8)
  await page.getByRole('button', { name: '编辑场次', exact: true }).click()
  await page.getByLabel('海豹日志链接', { exact: true }).fill('111111')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  const error = page.locator('.editor .system-message.error')
  await expect(error).toBeVisible()
  expect(await error.evaluate((n) => getComputedStyle(n).alignItems)).toBe('center')
  expect(await error.locator('.message-symbol').evaluate((n) => getComputedStyle(n).marginTop)).toBe('0px')
  await page.getByRole('button', { name: '取消编辑', exact: true }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const version = page.getByRole('region', { name: '版本说明', exact: true })
  await expect(version).toContainText('数据仅本机保存、无账户')
  await expect(version).toContainText('仅海豹链接相关联网')
  await expect(version).toContainText('应用制作：亦如长风万里沙')
})
