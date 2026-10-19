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

test('批量检测按模组折叠并实时统计，完成按钮退出', async () => {
  fs.mkdirSync(path.join(root, 'work'), { recursive: true })
  const directory = fs.mkdtempSync(path.join(root, 'work', 'coc-batch-check-'))
  const app = await launch(directory)
  try {
    const page = await app.firstWindow()
    const fixtures = await page.evaluate(
      async (archiveDirectory) => {
        await window.coc.settings.update({ archiveDirectory, autoBackup: { enabled: false } })
        const first = await window.coc.modules.create({ name: '公开模组甲', playStatus: 'not_started' })
        const second = await window.coc.modules.create({ name: '公开模组乙', playStatus: 'not_started' })
        const success = await window.coc.records.create({
          moduleId: first.id,
          name: '第一场',
          link: 'https://log.weizaima.com/?key=public-one'
        })
        const failed = await window.coc.records.create({
          moduleId: second.id,
          name: '第一场',
          link: 'https://log.weizaima.com/?key=public-two'
        })
        const manual = await window.coc.records.create({
          moduleId: second.id,
          name: '第二场',
          manualContent: '公开手动内容'
        })
        return { success, failed, manual }
      },
      path.join(directory, 'archive')
    )
    await app.evaluate(({ ipcMain }, fixtures) => {
      ipcMain.removeHandler('records:probe')
      ipcMain.handle('records:probe', async (_event, { id }) => {
        if (id === fixtures.manual.id) throw new Error('手动场次不应联网检测')
        if (id === fixtures.success.id) {
          await new Promise((resolve) => setTimeout(resolve, 80))
          return { ok: true, value: { ...fixtures.success, status: 'valid' } }
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
        return { ok: true, value: { ...fixtures.failed, status: 'fetch_failed', lastError: '公开网络失败' } }
      })
    }, fixtures)
    await page.reload()
    await page.getByRole('button', { name: '批量检测', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '批量检测', exact: true })
    await dialog.getByLabel('公开模组甲', { exact: false }).check()
    await dialog.getByLabel('公开模组乙', { exact: false }).check()
    await dialog.getByRole('button', { name: '开始检测', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '展开公开模组甲', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '展开公开模组乙', exact: true })).toBeVisible()
    const summary = dialog.getByRole('status')
    await expect(summary).toContainText('成功 1')
    await expect(summary).toContainText('失败 0')
    await expect(summary).toContainText('手动保存内容 1 场')
    await expect(summary).toContainText('链接 2 条')
    await expect(dialog.getByRole('button', { name: '检测完毕', exact: true })).toBeEnabled()
    await expect(summary).toContainText('失败 1')
    await dialog.getByRole('button', { name: '展开公开模组乙', exact: true }).click()
    const group = dialog.locator('.check-module').filter({ hasText: '公开模组乙' })
    await expect(group).toContainText('公开网络失败')
    await expect(group).toContainText('手动内容，无需检测')
    await page.screenshot({ path: path.join(directory, 'batch-grouped.png') })
    await dialog.getByRole('button', { name: '检测完毕', exact: true }).click()
    await expect(dialog).toBeHidden()
  } finally {
    await app.close()
  }
})

test('仅有手动正文的模组可以选择并直接完成，不发起检测', async () => {
  fs.mkdirSync(path.join(root, 'work'), { recursive: true })
  const directory = fs.mkdtempSync(path.join(root, 'work', 'coc-batch-manual-'))
  const app = await launch(directory)
  try {
    const page = await app.firstWindow()
    await page.evaluate(
      async (archiveDirectory) => {
        await window.coc.settings.update({ archiveDirectory, autoBackup: { enabled: false } })
        const module = await window.coc.modules.create({ name: '公开手动模组', playStatus: 'not_started' })
        await window.coc.records.create({ moduleId: module.id, manualContent: '公开手动正文' })
      },
      path.join(directory, 'archive')
    )
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('records:probe')
      ipcMain.handle('records:probe', () => {
        throw new Error('不应联网')
      })
    })
    await page.reload()
    await page.getByRole('button', { name: '批量检测', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '批量检测', exact: true })
    await dialog.getByLabel('公开手动模组', { exact: false }).check()
    await dialog.getByRole('button', { name: '开始检测', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '检测完毕', exact: true })).toBeEnabled()
    await expect(dialog.getByRole('status')).toContainText('链接 0 条')
    await expect(dialog.getByRole('status')).toContainText('失败 0')
    await expect(dialog.getByRole('status')).toContainText('手动保存内容 1 场')
    await dialog.getByRole('button', { name: '检测完毕', exact: true }).click()
    await expect(dialog).toBeHidden()
  } finally {
    await app.close()
  }
})
