import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const executablePath = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')

function cleanEnvironment(dataDirectory: string): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toLowerCase() !== 'path' && value !== undefined) environment[key] = value
  }
  environment.PATH = process.env.PATH || process.env.Path || ''
  environment.PORTABLE_EXECUTABLE_DIR = dataDirectory
  return environment
}

async function launch(dataDirectory: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath,
    args: ['.'],
    cwd: projectRoot,
    env: cleanEnvironment(dataDirectory)
  })
}

test('real desktop shell persists data and isolates Node', async () => {
  const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-e2e-中文-'))
  let application = await launch(portableRoot)
  try {
    let page = await application.firstWindow()

    await expect(page.getByText('COC 跑团记录簿').first()).toBeVisible()
    expect(
      await page.locator('.titlebar').evaluate((element) => element.getBoundingClientRect().height)
    ).toBeCloseTo(46, 1)
    await expect(page.locator('.window-controls button')).toHaveCount(3)
    expect(
      await page.evaluate(() => ({
        require: typeof Reflect.get(window, 'require'),
        process: typeof Reflect.get(window, 'process'),
        api: typeof window.coc
      }))
    ).toEqual({ require: 'undefined', process: 'undefined', api: 'object' })

    await page.getByRole('button', { name: '+ 新建模组' }).click()
    await page.getByLabel('模组名').fill('暗影循迹')
    await page.getByLabel('KP（每行一位）').fill('阿默')
    await page.getByRole('button', { name: '+ 添加一对 PC / PL' }).click()
    await page.getByLabel('PC1').fill('林恩')
    await page.getByLabel('PL1').fill('小夏')
    await page.getByRole('button', { name: '保存模组' }).click()
    await expect(page.getByRole('button', { name: '暗影循迹', exact: true })).toBeVisible()

    await page.getByRole('button', { name: '+ 添加场次' }).click()
    await page.getByLabel('手动记录正文').fill('雨落在窗上。')
    await page.getByLabel('跑团日期').fill('2025-03-08')
    await page.getByRole('button', { name: '保存场次' }).click()
    await expect(page.getByRole('button', { name: '暗影循迹第 1 场' })).toBeVisible()
    for (const label of ['\u539f\u59cb\u6587\u4ef6', '\u5e26\u56fe DOC', '\u5bf9\u8bdd DOC', 'DOCX', 'TXT', 'PDF']) {
      await expect(page.getByRole('button', { name: label })).toBeVisible()
    }

    await page.getByLabel('选择 暗影循迹第 1 场').check()
    await page.getByRole('button', { name: '批量合成' }).click()
    await expect(page.getByRole('dialog', { name: '批量合成' })).toContainText('按场次当前顺序合成为一个文件')
    await page.getByRole('dialog', { name: '批量合成' }).getByRole('button', { name: '取消' }).click()

    await page.getByRole('button', { name: '调查员角色卡' }).click()
    await page.getByRole('button', { name: '+ 新建角色卡' }).click()
    await page.getByLabel('姓名').fill('林恩')
    await page.getByLabel('职业', { exact: true }).fill('记者')
    await page.getByLabel('所属模组').selectOption({ label: '暗影循迹' })
    await page.getByLabel('STR', { exact: true }).fill('57')
    await page.getByRole('button', { name: '保存角色卡' }).click()
    await expect(page.getByRole('button', { name: /林恩/ })).toBeVisible()

    await page.getByRole('button', { name: '数据与设置' }).click()
    await page.locator('.segmented').getByRole('button', { name: '深色' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await application.close()

    expect(fs.existsSync(path.join(portableRoot, 'data', 'coc.sqlite'))).toBe(true)
    application = await launch(portableRoot)
    page = await application.firstWindow()
    await expect(page.getByRole('button', { name: '暗影循迹', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: '调查员角色卡' }).click()
    await expect(page.getByRole('button', { name: /林恩/ })).toBeVisible()
  } finally {
    await application.close().catch(() => undefined)
  }
})
