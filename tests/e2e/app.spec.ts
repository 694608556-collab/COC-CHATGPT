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
    expect(await page.locator('.resize-handle').count()).toBe(8)
    expect(
      await page.locator('.app-shell').evaluate((element) =>
        getComputedStyle(element).borderRadius
      )
    ).toBe('14px')
    await page.evaluate(() => document.fonts.ready)
    const loadedFonts = await page.evaluate(() => Array.from(document.fonts).map((font) => font.family))
    expect(loadedFonts).toContain('SF Pro Text')
    expect(loadedFonts).toContain('SF Pro Display')
    expect(loadedFonts).toContain('PingFang SC')
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

    await expect(page.locator('.module-header')).not.toContainText('深色')
    await expect(page.locator('.module-header')).not.toContainText('浅色')
    await page.getByRole('button', { name: '+ 新建模组' }).click()
    await page.getByRole('dialog', { name: '新建模组' })
      .getByRole('button', { name: '取消' }).click()
    await page.getByRole('button', { name: '选项预设' }).click()
    const preset = page.getByRole('dialog', { name: '选项预设' })
    await expect(preset).not.toContainText('首行缩进对齐')
    await expect(preset).not.toContainText('深色模式展示')
    const imageFilter = preset.getByRole('button', {
      name: /表情图片过滤/
    })
    await expect(imageFilter).not.toHaveClass(/active/)
    await imageFilter.click()
    await expect(imageFilter).toHaveClass(/active/)
    await preset.getByRole('button', { name: '取消' }).click()
    await page.getByRole('button', { name: '+ 新建模组' }).click()
    await page.getByLabel('模组名').fill('暗影循迹')
    await page
      .getByRole('textbox', {
        name: 'KP1',
        exact: true
      })
      .fill('阿默')
    await page.getByRole('button', { name: '+ 添加一对 PC / PL' }).click()
    await page
      .getByRole('textbox', {
        name: 'PC1',
        exact: true
      })
      .fill('林恩')
    await page
      .getByRole('textbox', {
        name: 'PL1',
        exact: true
      })
      .fill('小夏')
    await page.getByRole('button', { name: '保存模组' }).click()
    await expect(page.getByRole('button', { name: '暗影循迹', exact: true })).toBeVisible()
    await page.locator('.module-card').first().getByRole('button', { name: '删除' }).click()
    await expect(page.getByRole('dialog', { name: '删除模组' }))
      .toContainText('角色卡会保留')
    await page.getByRole('dialog', { name: '删除模组' })
      .getByRole('button', { name: '取消' }).click()

    await page.getByRole('button', { name: '+ 添加场次' }).click()
    await page.getByLabel('手动记录正文').fill('雨落在窗上。')
    await page.getByLabel('跑团日期').fill('2025-03-08')
    await page.getByRole('button', { name: '保存场次' }).click()
    await expect(page.getByRole('button', { name: '暗影循迹第 1 场' })).toBeVisible()
    await page.getByRole('button', { name: '导入表格' }).click()
    await expect(page.getByRole('dialog', { name: '导入表格' })).toContainText('模组名称')
    await page
      .getByRole('dialog', { name: '导入表格' })
      .getByRole('button', {
        name: '关闭',
        exact: true
      })
      .click()
    await page.getByRole('button', { name: '批量检测' }).click()
    await expect(page.getByRole('dialog', { name: '批量检测' })).toContainText('按模组合集检测')
    await page.getByRole('dialog', { name: '批量检测' }).getByRole('button', { name: '取消' }).click()
    await expect(page.getByRole('status')).toBeVisible()
    await expect(page.getByRole('status')).toBeHidden({
      timeout: 6_000
    })
    for (const label of [
      '\u539f\u59cb\u6587\u4ef6',
      '\u5e26\u56fe DOC',
      '\u5bf9\u8bdd DOC',
      'DOCX',
      'TXT',
      'PDF'
    ]) {
      await expect(page.getByRole('button', { name: label })).toBeVisible()
    }

    await page.getByLabel('选择 暗影循迹第 1 场').check()
    await page.getByRole('button', { name: '批量合成' }).click()
    await expect(page.getByRole('dialog', { name: '批量合成' })).toContainText('按场次当前顺序合成为一个文件')
    await page.getByRole('dialog', { name: '批量合成' }).getByRole('button', { name: '取消' }).click()

    await page.getByRole('button', { name: '调查员角色卡' }).click()
    await page.getByRole('button', { name: '+ 新建角色卡' }).click()
    await page.getByLabel('角色名').fill('林恩')
    await page.getByLabel('职业', { exact: true }).fill('记者')
    const editor = page.getByRole('dialog', {
      name: /调查员角色卡/
    })
    await editor
      .getByRole('checkbox', {
        name: '暗影循迹'
      })
      .check()
    await page.getByLabel('力量').fill('57')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('button', { name: /林恩/ })).toBeVisible()

    await page.getByRole('button', { name: '+ 新建角色卡' }).click()
    await page.getByLabel('角色名').fill('临时调查员')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    const tempCard = page.locator('.character-card').filter({ hasText: '临时调查员' })
    await expect(tempCard).toBeVisible()
    await tempCard.getByRole('button', { name: '删除' }).click()
    const deleteDialog = page.getByRole('dialog', { name: '删除角色卡' })
    await expect(deleteDialog).toContainText('临时调查员')
    await deleteDialog.getByRole('button', { name: '取消' }).click()
    await expect(tempCard).toBeVisible()
    await tempCard.getByRole('button', { name: '删除' }).click()
    await page.getByRole('dialog', { name: '删除角色卡' }).getByRole('button', { name: '确认删除' }).click()
    await expect(page.locator('.character-card').filter({ hasText: '临时调查员' })).toHaveCount(0)

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
