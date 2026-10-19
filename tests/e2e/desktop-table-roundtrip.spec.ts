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

test('模组场次导出表格与界面重新导入保留手动正文', async () => {
  fs.mkdirSync(path.join(root, 'work'), { recursive: true })
  const directory = fs.mkdtempSync(path.join(root, 'work', 'coc-088-table-'))
  const app = await launch(directory)
  try {
    const page = await app.firstWindow()
    const body = '公开手动正文，含"引号"\n\n下一段😀' + '长篇内容\n'.repeat(8000) + '末段'
    const entries = await page.evaluate(
      async ({ body, archiveDirectory }) => {
        await window.coc.settings.update({ archiveDirectory, autoBackup: { enabled: false } })
        const module = await window.coc.modules.create({
          name: '公开场次导出',
          playStatus: 'not_started',
          kps: ['公开KP']
        })
        const record = await window.coc.records.create({
          moduleId: module.id,
          name: '第一场',
          manualContent: body
        })
        return Promise.all(
          ['csv', 'xlsx'].map((format) => window.coc.files.exportTable([record.id], format as 'csv' | 'xlsx'))
        )
      },
      { body, archiveDirectory: path.join(directory, 'archive') }
    )
    await page.reload()
    for (const entry of entries) {
      await page.getByRole('button', { name: '导入表格', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '导入表格', exact: true })
      await dialog.locator('input[type=file]').setInputFiles(entry.path)
      await expect(dialog).toContainText('覆盖更新 1 场')
      await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click()
      const records = await page.evaluate(async () => (await window.coc.app.snapshot()).records)
      expect(records).toHaveLength(1)
      expect(records[0]!.manualContent).toBe(body)
      expect(records[0]!.status).toBe('manual')
    }
  } finally {
    await app.close()
  }
})
