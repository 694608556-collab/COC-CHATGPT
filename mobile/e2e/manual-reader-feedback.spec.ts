import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { searchSample } from '../src/dev/sample'
import { acceptAppConfirmations, expandModules } from './helpers'

test('手动正文跳过空白卡片，分页搜索一致且备份保留原换行', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const sample = searchSample()
  const body = '\r\n' + Array.from({ length: 101 }, (_, i) => `公开正文${i + 1}\r\n \t\r\n　\n`).join('')
  sample.records = [{ ...sample.records[1]!, manualContent: body }]
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await chooser
  ).setFiles({
    name: 'public-blank-lines.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
  await page.reload()
  await expandModules(page)
  await page.locator(`[data-record-id="${sample.records[0]!.id}"]`).click()
  await expect(page.locator('.messages .message')).toHaveCount(100)
  await expect(page.getByText(/正文共 101 行/)).toBeVisible()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.locator('.messages .message')).toHaveCount(1)
  await expect(page.locator('.messages')).toHaveText('公开正文101')
  await page.getByRole('searchbox', { name: '搜索整场正文' }).fill('公开正文101')
  await page.getByRole('searchbox', { name: '搜索整场正文' }).press('Enter')
  await page.getByRole('button', { name: /结果 1 · 正文第 2 页/ }).click()
  await expect(page.locator('.search-target')).toHaveText('公开正文101')
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.getByRole('button', { name: '保存安卓备份', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('备份已保存并回读校验')
  await page.getByRole('button', { name: '刷新测试文件列表', exact: true }).click()
  await page.getByText('测试文件（1）', { exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^coc-android-backup-.*\.json$/ }).click()
  const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  expect(saved.snapshot.records[0].manualContent).toBe(body)
})

test('批量选择末行仅显示外框，浅深色及窄屏一致', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await page.getByRole('button', { name: '批量检测', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '批量检测', exact: true })
  for (const width of [320, 412]) {
    await page.setViewportSize({ width, height: 740 })
    for (const theme of ['light', 'dark']) {
      await page.locator('html').evaluate((el, value) => el.setAttribute('data-theme', value), theme)
      for (const mode of ['按模组合集检测', '单链接检测']) {
        await panel.getByRole('button', { name: mode, exact: true }).click()
        await expect(panel.locator('.check-selector label').first()).toHaveCSS('border-bottom-width', '1px')
        await expect(panel.locator('.check-selector label').last()).toHaveCSS('border-bottom-width', '0px')
        await expect(panel.locator('.check-selector')).toHaveCSS('border-bottom-width', '1px')
        await expect(panel.locator('.check-selector')).toHaveCSS('box-shadow', 'none')
      }
    }
  }
})
