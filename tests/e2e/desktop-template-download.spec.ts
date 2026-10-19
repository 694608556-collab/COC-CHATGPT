import * as XLSX from 'xlsx'
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
  test(`${format} 下载的空白模板含手动正文列且人员不串位`, async () => {
    fs.mkdirSync(path.join(root, 'work'), { recursive: true })
    const directory = fs.mkdtempSync(path.join(root, 'work', 'coc-template-download-'))
    const app = await launch(directory)
    try {
      const page = await app.firstWindow()
      const destination = path.join(directory, `downloaded.${format}`)
      await app.evaluate(({ BrowserWindow }, destination) => {
        const testState = globalThis as typeof globalThis & {
          cocTemplateDownload?: { state: string; fileName: string }
        }
        testState.cocTemplateDownload = undefined
        BrowserWindow.getAllWindows()[0]!.webContents.session.once('will-download', (_event, item) => {
          item.setSavePath(destination)
          item.once('done', (_event, state) => {
            testState.cocTemplateDownload = { state, fileName: item.getFilename() }
          })
        })
      }, destination)
      await page.getByRole('button', { name: '导入表格', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '导入表格', exact: true })
      await dialog
        .getByRole('button', {
          name: format === 'csv' ? '下载空白模板（CSV）' : '下载空白模板（xlsx）',
          exact: true
        })
        .click()
      await expect
        .poll(() =>
          app.evaluate(
            () =>
              (globalThis as typeof globalThis & { cocTemplateDownload?: { state: string } })
                .cocTemplateDownload?.state
          )
        )
        .toBe('completed')
      const fileName = await app.evaluate(
        () =>
          (globalThis as typeof globalThis & { cocTemplateDownload?: { fileName: string } })
            .cocTemplateDownload?.fileName
      )
      expect(fileName).toBe(`COC跑团记录导入模板.${format}`)
      const book = XLSX.read(fs.readFileSync(destination))
      const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]!]!, { header: 1 })
      const headers = rows[0]!
      expect(headers.indexOf('手动保存内容')).toBe(headers.indexOf('KP1') - 1)
      expect(rows[1]![headers.indexOf('KP1')]).toBe('阿默')
    } finally {
      await app.close()
    }
  })
}
