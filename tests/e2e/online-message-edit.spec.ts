import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { mainWindow } from './main-window'

const root = path.resolve(import.meta.dirname, '../..')
test('online speaker edit preserves metadata and refuses a stale UI draft', async () => {
  const directory = fs.mkdtempSync(path.join(root, 'work', 'online-speaker-'))
  const app = await electron.launch({
    executablePath: process.env.COC_E2E_EXECUTABLE || path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [...(process.env.COC_E2E_EXECUTABLE ? [] : ['.']), '--no-sandbox', '--user-data-dir=' + directory],
    cwd: root, env: { ...process.env, PORTABLE_EXECUTABLE_DIR: directory, TEMP: directory, TMP: directory }
  })
  try {
    const page = await mainWindow(app)
    const id = await page.evaluate(async () => {
      const module = await window.coc.modules.create({ name: '公开在线正文', playStatus: 'running' })
      return (await window.coc.records.create({ moduleId: module.id, link: 'https://log.weizaima.com/?key=public-ui-edit' })).id
    })
    // Seed the isolated database with a public fetched-message fixture, then use the normal reader and IPC.
    await app.evaluate((_electron, input) => {
      const sqlite = process.getBuiltinModule('node:sqlite')
      const db = new sqlite.DatabaseSync(input.database)
      db.prepare('UPDATE records SET status=?,raw_json=? WHERE id=?').run('valid', JSON.stringify({
        parserVersion: 1, messages: [{ id: 'public-message', order: 0, displayName: '原说话者', text: '原正文',
          platformAccount: 'public-123', timestamp: '2026-11-17T00:00:00Z', type: 'text',
          isDiceCommand: false, isOffTopic: false, images: [], raw: { preserved: true } }]
      }), input.id)
      db.close()
    }, { id, database: path.join(directory, 'data/coc.sqlite') })
    await page.reload()
    await page.locator('.record-name').first().click()
    const reader = page.getByRole('dialog').first()
    await reader.locator('.log-preview article').first().dblclick()
    const editor = page.getByRole('dialog', { name: '编辑正文', exact: true })
    await expect(editor.getByLabel('说话者')).toHaveCSS('border-radius', '8px')
    await expect(editor.getByLabel('正文内容')).toHaveCSS('border-radius', '8px')
    await expect(editor.getByLabel('说话者')).toHaveValue('原说话者')
    await editor.getByLabel('说话者').fill('编辑说话者')
    await editor.getByLabel('正文内容').fill('编辑完整正文\n第二行')
    await editor.screenshot({ path: path.join(directory, 'editor-light.png') })
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
    await editor.screenshot({ path: path.join(directory, 'editor-dark-normal.png') })
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    await editor.getByRole('button', { name: '保存正文', exact: true }).click()
    await expect(editor).toHaveCount(0)
    await expect(reader.locator('.log-preview article strong').first()).toContainText('编辑说话者')
    const saved = await page.evaluate(async (id) => (await window.coc.app.snapshot()).records.find((row) => row.id === id)!, id)
    expect(saved.rawContent!.messages[0]).toMatchObject({ displayName: '编辑说话者', text: '编辑完整正文\n第二行', platformAccount: 'public-123', raw: { preserved: true } })
    await reader.locator('.log-preview article').first().dblclick()
    await editor.getByLabel('说话者').fill('失效草稿说话者')
    await editor.getByLabel('正文内容').fill('失效草稿正文')
    await page.evaluate(async (saved) => {
      await window.coc.records.editMessage(saved.id, 'public-message', '另一份已保存正文', '另一说话者', saved.updatedAt)
    }, saved)
    await editor.getByRole('button', { name: '保存正文', exact: true }).click()
    await expect(editor.getByRole('alert')).toContainText('数据已变化')
    await expect(editor.getByLabel('说话者')).toHaveValue('失效草稿说话者')
    await expect(editor.getByLabel('正文内容')).toHaveValue('失效草稿正文')
    const stored = await page.evaluate(async (id) => (await window.coc.app.snapshot()).records.find((row) => row.id === id)!, id)
    expect(stored.rawContent!.messages[0]).toMatchObject({ displayName: '另一说话者', text: '另一份已保存正文' })
    await page.screenshot({ path: path.join(directory, 'stale-draft-preserved.png') })
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
    await expect(editor.getByLabel('说话者')).toHaveCSS('background-color', 'rgb(23, 26, 33)')
    await expect(editor.getByLabel('正文内容')).toHaveCSS('background-color', 'rgb(23, 26, 33)')
    await page.screenshot({ path: path.join(directory, 'editor-dark.png') })
  } finally { await app.close() }
})
