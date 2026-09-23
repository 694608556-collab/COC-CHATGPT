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
    // isolate the Electron user data so a second instance never hits the
    // single instance lock and nothing is written to the real profile
    args: ['.', `--user-data-dir=${dataDirectory}`],
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
    // 0.6.1 起八方向缩放完全交给系统原生隐形边框，渲染层不再有任何 DOM 热区
    expect(await page.locator('.resize-handle').count()).toBe(0)
    await expect(page.locator('.window-frame .app-shell')).toHaveCount(1)
    await expect(page.locator('.privacy-note')).toContainText('数据仅本机保存、无账户')

    // 原生缩放回归（0.6.1）：0.6.0 的根因是 resizable:false 禁用了系统隐形边框。
    // 这里在主进程侧确定性地断言窗口可自由缩放、最小尺寸生效；隐形边框八方向的
    // 鼠标手感（左/上/四角在窗口 bounds 外侧，CDP 合成鼠标事件无法稳定命中）
    // 由真人实机验收，不用像素拖拽断言，避免 DPI 缩放导致的随机失败。
    const resizeInfo = await application.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) throw new Error('没有可用的应用窗口')
      const before = win.getBounds()
      const resizable = win.isResizable()
      const maximizable = win.isMaximizable()
      win.setSize(1400, 900)
      const medium = win.getSize()
      win.setSize(200, 200) // 低于最小尺寸，应被钳制到 960x640
      const clamped = win.getSize()
      win.setBounds(before)
      return { resizable, maximizable, medium, clamped }
    })
    expect(resizeInfo.resizable).toBe(true)
    expect(resizeInfo.maximizable).toBe(true)
    expect(Math.abs(resizeInfo.medium[0]! - 1400)).toBeLessThanOrEqual(8)
    expect(Math.abs(resizeInfo.medium[1]! - 900)).toBeLessThanOrEqual(8)
    expect(resizeInfo.clamped[0]).toBeGreaterThanOrEqual(960)
    expect(resizeInfo.clamped[1]).toBeGreaterThanOrEqual(640)
    await page.waitForTimeout(300)
    expect(
      await page.locator('.app-shell').evaluate((element) =>
        getComputedStyle(element).borderRadius
      )
    ).toBe('0px')
    await page.evaluate(() => document.fonts.ready)
    const loadedFonts = await page.evaluate(() => Array.from(document.fonts).map((font) => font.family))
    expect(loadedFonts).toContain('SF Pro Text')
    expect(loadedFonts).toContain('SF Pro Display')
    expect(loadedFonts).toContain('PingFang SC')
    expect(
      await page.locator('.titlebar').evaluate((element) => element.getBoundingClientRect().height)
    ).toBeCloseTo(46, 1)
    await expect(page.locator('.window-controls button')).toHaveCount(3)
    const titleIcon = page.locator('.app-icon')
    await expect(titleIcon).toBeVisible()
    expect(await titleIcon.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
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
    // 0.6.3 起跑团状态是必选项，不选无法保存
    await page.getByRole('radio', { name: '进行中' }).click()
    await page
      .getByRole('textbox', {
        name: 'KP1',
        exact: true
      })
      .fill('阿默')
    // the module editor delete icon shrinks while its button box stays 34px
    const moduleDeleteBox = await page.locator('.module-remove').first().boundingBox()
    const moduleDeleteIcon = await page.locator('.module-remove svg').first().boundingBox()
    expect(Math.round(moduleDeleteBox?.width ?? 0)).toBe(34)
    expect(Math.round(moduleDeleteIcon?.width ?? 0)).toBe(12)

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
    // exact 匹配：场次行的删除按钮 aria-label 是“删除场次 暗影循迹第 1 场”，
    // 非精确匹配会同时命中它而触发 strict mode 冲突
    await expect(page.getByRole('button', { name: '暗影循迹第 1 场', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '导入表格' }).click()
    const importDialog = page.getByRole('dialog', { name: '导入表格' })
    await expect(importDialog).toContainText('PC1/PL1')
    await expect(importDialog.getByRole('button', { name: '下载空白模板（xlsx）' })).toBeVisible()
    await expect(importDialog.getByRole('button', { name: '下载空白模板（CSV）' })).toBeVisible()
    await importDialog.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: '批量检测' }).click()
    await expect(page.getByRole('dialog', { name: '批量检测' })).toContainText('按模组合集检测')
    await page.getByRole('dialog', { name: '批量检测' }).getByRole('button', { name: '取消' }).click()
    await expect(page.getByRole('status')).toBeVisible()
    const toastBox = await page.getByRole('status').boundingBox()
    const shellBox = await page.locator('.app-shell').boundingBox()
    expect(toastBox).not.toBeNull()
    expect(shellBox).not.toBeNull()
    if (toastBox && shellBox) {
      expect(toastBox.x + toastBox.width).toBeGreaterThan(shellBox.x + shellBox.width - 80)
      expect(toastBox.y + toastBox.height).toBeGreaterThan(shellBox.y + shellBox.height - 80)
    }
    await expect(page.getByRole('status')).toBeHidden({
      timeout: 9_000
    })
    for (const label of [
      '\u539f\u59cb\u6587\u4ef6',
      '\u5e26\u56fe DOC',
      '\u5bf9\u8bdd DOC',
      'DOCX',
      'TXT',
      'PDF'
    ]) {
      await expect(page.locator('.row-actions').first().getByRole('button', { name: label })).toBeVisible()
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
    await expect(page.locator('.skill-editor .skill-row:not(.skill-row-head)').first().locator('input')).toHaveCount(2)
    await expect(page.locator('.skill-editor .skill-row:not(.skill-row-head)').first().getByRole('button')).toHaveCount(1)
    // the character editor delete icon shrinks while its button box stays 22px
    const characterDeleteBox = await page.locator('.character-editor .neutral-delete').first().boundingBox()
    const characterDeleteIcon = await page.locator('.character-editor .neutral-delete svg').first().boundingBox()
    expect(Math.round(characterDeleteBox?.width ?? 0)).toBe(22)
    expect(Math.round(characterDeleteIcon?.width ?? 0)).toBe(12)

    await page.getByLabel('力量').fill('57')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    // 卡片删除按钮的 aria-label 是“删除角色卡 林恩”，用卡片主体类名定位避免歧义
    await expect(page.locator('.character-card-main').first()).toContainText('林恩')

    // creating a card must not append a PC row to its module roster
    await page.getByRole('button', { name: '跑团记录汇总' }).click()
    const participants = page.locator('.participants').first()
    await expect(participants).toContainText('林恩 / 小夏')
    await expect(participants).not.toContainText('林恩 / 未填写')
    await page.getByRole('button', { name: '调查员角色卡' }).click()
    const cardBox = await page.locator('.character-card').first().boundingBox()
    const cardDeleteBox = await page
      .locator('.character-card')
      .first()
      .getByRole('button', { name: '删除' })
      .boundingBox()
    if (cardBox && cardDeleteBox) {
      expect(cardDeleteBox.y).toBeGreaterThan(cardBox.y + cardBox.height / 2)
    }
    const cardActionsBox = await page.locator('.character-card-actions').first().boundingBox()
    if (cardBox && cardActionsBox) {
      const gapBelow = Math.round(cardBox.y + cardBox.height - (cardActionsBox.y + cardActionsBox.height))
      expect(gapBelow).toBe(5)
    }

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

    await page.getByRole('button', { name: '跑团闲记' }).click()
    await expect(page.locator('.module-header h1')).toHaveText('跑团闲记')
    await page.getByRole('button', { name: '+ 新建闲记' }).click()
    await page.getByLabel('闲记内容').fill('第一行\n第二行')
    await page.getByLabel('模组名称').fill('暗影循迹')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.note-card')).toHaveCount(1)
    await expect(page.locator('.note-card-head').first()).toContainText('暗影循迹')
    await expect(page.locator('.note-card-head').first()).toContainText(/\d{4}-\d{2}-\d{2}/)
    await expect(page.locator('.note-content').first()).toContainText('第一行')

    // the default 1920 window shows five cards per row
    const noteColumns = await page
      .locator('.note-grid')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns)
    expect(noteColumns.split(' ')).toHaveLength(5)

    // clicking the card edits in place and Enter keeps a newline
    await page.locator('.note-card-main').first().click()
    const noteEditor = page.getByLabel('闲记内容')
    await expect(noteEditor).toHaveValue('第一行\n第二行')
    await expect(page.locator('.note-card-editing .note-card-actions button')).toHaveText([
      '删除',
      '取消',
      '保存'
    ])
    await noteEditor.focus()
    await noteEditor.press('Control+End')
    const noteText = await noteEditor.inputValue()
    await noteEditor.press('Enter')
    await noteEditor.pressSequentially('第三行')
    await expect(noteEditor).toHaveValue(noteText + '\n第三行')
    // Enter must not finish the edit
    await expect(noteEditor).toBeVisible()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.note-content').first()).toContainText('第三行')

    await page.getByRole('button', { name: '数据与设置' }).click()
    await expect(page.locator('.stats')).toContainText('闲记')
    await expect(page.locator('.stats div').filter({ hasText: '闲记' })).toContainText('1')
    await page.locator('.segmented').getByRole('button', { name: '深色' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await application.close()

    expect(fs.existsSync(path.join(portableRoot, 'data', 'coc.sqlite'))).toBe(true)
    application = await launch(portableRoot)
    page = await application.firstWindow()
    await expect(page.getByRole('button', { name: '暗影循迹', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: '调查员角色卡' }).click()
    await expect(page.locator('.character-card-main').first()).toContainText('林恩')
  } finally {
    await application.close().catch(() => undefined)
  }
})
