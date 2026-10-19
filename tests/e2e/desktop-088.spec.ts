import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { publicCoc7Bytes, publicCoc7Workbook } from '../fixtures/coc7'

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
/** 代替人工选择公开夹具，仍通过实际IPC、解析器和编辑器。@param app 测试应用。@param file 文件路径。@returns 无返回值。 */
async function choose(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, file)
}

test('七版导入补填、取消、同名保护和重启持久化', async () => {
  fs.mkdirSync(path.join(root, 'work'), { recursive: true })
  const directory = fs.mkdtempSync(path.join(root, 'work', 'coc-088-import-'))
  const book = publicCoc7Workbook()
  delete book.Sheets['人物卡']!.E10
  const file = path.join(directory, 'public-missing-hp.xlsx')
  fs.writeFileSync(file, publicCoc7Bytes(book))
  let app = await launch(directory)
  try {
    let page = await app.firstWindow()
    await page.evaluate(
      async (archiveDirectory) => {
        await window.coc.settings.update({ archiveDirectory, autoBackup: { enabled: false } })
      },
      path.join(directory, 'archive')
    )
    await page.getByRole('button', { name: '调查员角色卡', exact: true }).click()
    await choose(app, file)
    await page.getByRole('button', { name: '导入第七版角色卡', exact: true }).click()
    let editor = page.getByRole('dialog', { name: '调查员角色卡', exact: true })
    await expect(editor.getByRole('status')).toContainText('E10')
    await expect(editor.getByRole('status')).not.toContainText('请在此补填')
    await expect(editor.getByLabel('当前 HP', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(editor.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
    await page.screenshot({ path: path.join(directory, 'import-missing.png') })
    await editor.getByRole('button', { name: '取消', exact: true }).click()
    expect(await page.evaluate(async () => (await window.coc.app.snapshot()).characters.length)).toBe(0)
    await page.getByRole('button', { name: '导入第七版角色卡', exact: true }).click()
    editor = page.getByRole('dialog', { name: '调查员角色卡', exact: true })
    await editor.getByLabel('当前 HP', { exact: true }).fill('0')
    await expect(editor.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
    await page.screenshot({ path: path.join(directory, 'import-filled.png') })
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect(editor).toBeHidden()
    await page.getByRole('button', { name: '导入第七版角色卡', exact: true }).click()
    editor = page.getByRole('dialog', { name: '调查员角色卡', exact: true })
    await editor.getByLabel('当前 HP', { exact: true }).fill('1')
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect(editor).toBeHidden()
    await app.close()
    app = await launch(directory)
    page = await app.firstWindow()
    const cards = await page.evaluate(async () => (await window.coc.app.snapshot()).characters)
    expect(cards).toHaveLength(2)
    expect(cards.map((card) => card.derived.hpCurrent).sort()).toEqual([0, 1])
    expect(cards[0]!.attrs.STR).toBe(60)
    expect(cards[0]!.items).toHaveLength(4)
  } finally {
    await app.close()
  }
})
