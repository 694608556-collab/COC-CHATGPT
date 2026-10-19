import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
/** 只使用独立临时目录，不接触真实用户数据库。@param directory 隔离目录。@returns 测试应用。 */
async function launch(directory: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath:
      process.env.COC_E2E_EXECUTABLE || path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [
      ...(process.env.COC_E2E_EXECUTABLE ? [] : ['.']),
      `--user-data-dir=${directory}`,
      ...(process.env.COC_E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])
    ],
    cwd: root,
    env: { ...process.env, TEMP: directory, TMP: directory, PORTABLE_EXECUTABLE_DIR: directory }
  })
}

for (const format of ['xlsx', 'csv'] as const) {
  test(`${format} 多模组历史文件移走后从界面再次导出正确提示成功`, async () => {
    fs.mkdirSync(path.join(root, 'work'), { recursive: true })
    const directory = fs.mkdtempSync(path.join(root, 'work', 'coc-export-feedback-'))
    const app = await launch(directory)
    try {
      const page = await app.firstWindow()
      const first = await page.evaluate(
        async ({ archiveDirectory, format }) => {
          await window.coc.settings.update({ archiveDirectory, autoBackup: { enabled: false } })
          for (const name of ['公开导出模组甲', '公开导出模组乙']) {
            const module = await window.coc.modules.create({ name, playStatus: 'not_started' })
            await window.coc.records.create({ moduleId: module.id, manualContent: '公开手动正文' })
          }
          return window.coc.files.exportTable(undefined, format)
        },
        { archiveDirectory: path.join(directory, 'archive'), format }
      )
      expect(path.resolve(first.path).startsWith(path.resolve(directory) + path.sep)).toBe(true)
      fs.unlinkSync(first.path)
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('files:show-item')
        ipcMain.handle('files:show-item', () => ({ ok: true, value: undefined }))
      })
      await page.reload()
      await page.getByRole('button', { name: '导出表格', exact: true }).click()
      await page
        .getByRole('dialog', { name: '导出表格', exact: true })
        .getByRole('button', { name: `导出 ${format.toUpperCase()}`, exact: true })
        .click()
      await expect(page.getByRole('status')).toContainText('表格已保存')
      const entries = await page.evaluate(async () =>
        (await window.coc.app.snapshot()).archiveEntries.filter((entry) => entry.ownerId === 'record-table')
      )
      expect(entries).toHaveLength(2)
      const next = entries.find((entry) => entry.id !== first.id)!
      expect(next.path).not.toBe(first.path)
      expect(fs.statSync(next.path).size).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })
}
