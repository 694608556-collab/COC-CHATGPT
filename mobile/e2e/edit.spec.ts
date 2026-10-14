import { expandModules } from './helpers'
import { expect, test } from '@playwright/test'
import { exampleBackup } from '../src/data/fixtures'

test('320px：缺少 randomUUID 时可创建角色，导入后的在线正文仍保留', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'randomUUID', {
      value: undefined,
      configurable: true,
      writable: true
    })
  })
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await chooser
  ).setFiles({
    name: 'public.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exampleBackup()))
  })
  await page.getByRole('button', { name: /确认.*覆盖/ }).click()
  await expandModules(page)
  await page.getByRole('button', { name: /示例模组.*第一场/ }).click()
  await page.getByRole('button', { name: '编辑场次', exact: true }).click()
  await page.getByLabel('场次名称', { exact: true }).fill('修改名称后')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expandModules(page)
  await page.getByRole('button', { name: /示例模组.*修改名称后/ }).click()
  await expect(page.getByText('离线正文', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: '新建六版角色', exact: true }).click()
  await page.getByLabel('姓名', { exact: true }).fill('旧环境测试')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/editor-320.png', fullPage: true })
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('button', { name: /旧环境测试/ })).toBeVisible()
})

test('手机宽度：新建、取消、保存、重开和备份', async ({ page }) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '新增模组', exact: true }).click()
  await page.getByLabel('模组名称', { exact: true }).fill('公开测试模组')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('修改已保存')
  await expandModules(page)
  await page.getByRole('button', { name: '新增手动场次', exact: true }).click()
  await page.getByLabel('场次名称', { exact: true }).fill('第一场')
  await page.getByLabel('手动正文', { exact: true }).fill('公开测试正文\n第二段')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expandModules(page)
  await page.getByRole('button', { name: /公开测试模组.*第一场/ }).click()
  await expect(page.getByText('公开测试正文', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '编辑场次', exact: true }).click()
  await page.getByLabel('场次名称', { exact: true }).fill('应丢弃')
  await page.getByRole('button', { name: '取消编辑', exact: true }).click()
  await expect(page.getByRole('heading', { name: '第一场' })).toBeVisible()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: '新建七版角色', exact: true }).click()
  await page.getByLabel('姓名', { exact: true }).fill('公开调查员')
  await page.getByLabel('STR', { exact: true }).fill('65')
  await page.getByLabel('调查员经历', { exact: true }).fill('仅用于自动测试')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: /公开调查员/ }).click()
  await expect(page.getByText('仅用于自动测试', { exact: true })).toBeVisible()
  await expect(page.getByText('65', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({
    path: 'test-results/character-412.png',
    fullPage: true
  })
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.getByRole('button', { name: '保存安卓备份', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('备份已保存')
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await expect(page.getByText('测试文件（4）', { exact: true })).toBeVisible()
  expect(failures).toEqual([])
})
