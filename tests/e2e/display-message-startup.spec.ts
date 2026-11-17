import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { mainWindow } from './main-window'

const root = path.resolve(import.meta.dirname, '../..')
test('early splash, font preference, speaker/body editing, cancellation and restart', async () => {
  fs.mkdirSync(path.join(root, 'work'), { recursive: true })
  const directory = fs.mkdtempSync(path.join(root, 'work', 'display-message-'))
  /** @returns 使用独立数据库启动的应用。 */
  const launch = () => electron.launch({
    executablePath: process.env.COC_E2E_EXECUTABLE || path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [...(process.env.COC_E2E_EXECUTABLE ? [] : ['.']), '--no-sandbox', '--user-data-dir=' + directory],
    cwd: root, env: { ...process.env, PORTABLE_EXECUTABLE_DIR: directory, TEMP: directory, TMP: directory }
  })
  let app = await launch()
  try {
    const splash = await app.firstWindow()
    await expect(splash.getByRole('progressbar', { name: '正在打开记录簿' })).toBeVisible()
    let page = await mainWindow(app)
    await page.getByRole('button', { name: '数据与设置', exact: true }).click()
    const sizes = page.locator('[aria-label="显示字号"]')
    const before = await page.locator('h1').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))
    await sizes.getByRole('button', { name: '特大', exact: true }).click()
    expect(await page.locator('h1').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThan(before)
    const recordId = await page.evaluate(async () => {
      const module = await window.coc.modules.create({ name: '公开编辑模组', playStatus: 'running' })
      return (await window.coc.records.create({ moduleId: module.id, manualContent: '首段原文\n第二段保留' })).id
    })
    await page.reload()
    await page.getByRole('button', { name: '跑团记录汇总', exact: true }).click()
    // Open through the visible record entry created by the normal IPC.
    await page.locator('.record-name').first().click()
    const reader = page.getByRole('dialog').first()
    await reader.locator('.log-preview article').first().dblclick()
    const editor = page.getByRole('dialog', { name: '编辑正文', exact: true })
    await editor.getByLabel('说话者', { exact: true }).fill('取消角色')
    await editor.getByLabel('正文内容').fill('取消正文')
    await editor.getByRole('button', { name: '取消', exact: true }).click()
    expect((await page.evaluate(async (id) => (await window.coc.app.snapshot()).records.find((row) => row.id === id), recordId))!.manualContent).toBe('首段原文\n第二段保留')
    await reader.locator('.log-preview article').first().dblclick()
    await editor.getByLabel('说话者', { exact: true }).fill('新说话者')
    await editor.getByLabel('正文内容').fill('修改正文\n保留换行')
    await editor.getByRole('button', { name: '保存正文', exact: true }).click()
    await expect(editor).toHaveCount(0)
    await expect(reader.locator('.log-preview article strong').first()).toContainText('新说话者')
    await expect(reader.locator('.log-preview article p').first()).toHaveText('修改正文\n保留换行')
    await page.screenshot({ path: path.join(directory, 'speaker-editor-saved.png') })
    await app.close()
    app = await launch()
    page = await mainWindow(app)
    await page.getByRole('button', { name: '数据与设置', exact: true }).click()
    await expect(page.locator('[aria-label="显示字号"]').getByRole('button', { name: '特大', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const saved = await page.evaluate(async (id) => (await window.coc.app.snapshot()).records.find((row) => row.id === id), recordId)
    expect(saved!.rawContent!.messages[0]).toMatchObject({ displayName: '新说话者', text: '修改正文\n保留换行' })
    expect(saved!.manualContent).toBe('新说话者：修改正文\n保留换行\n第二段保留')
  } finally { await app.close() }
})
