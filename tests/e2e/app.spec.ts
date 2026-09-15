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
    expect(await page.locator('.resize-handle').count()).toBe(8)
    await expect(page.locator('.window-frame .app-shell')).toHaveCount(1)
    await expect(page.locator('.privacy-note')).toContainText('数据仅本机保存、无账户')

    // the drag area must straddle the visible edge of the shell, not sit in the gutter
    const windowShellBox = await page.locator('.app-shell').boundingBox()
    const northBox = await page.locator('.resize-n').boundingBox()
    expect(windowShellBox).not.toBeNull()
    expect(northBox).not.toBeNull()
    if (windowShellBox && northBox) {
      expect(northBox.y).toBeLessThan(windowShellBox.y)
      expect(northBox.y + northBox.height).toBeGreaterThan(windowShellBox.y)
    }

    // dragging that edge really resizes the window
    const beforeResize = await page.evaluate(() => window.coc.window.getBounds())
    const southEast = await page.locator('.resize-se').boundingBox()
    expect(southEast).not.toBeNull()
    if (southEast) {
      await page.mouse.move(southEast.x + southEast.width / 2, southEast.y + southEast.height / 2)
      await page.mouse.down()
      // drag inwards so every synthetic pointer position stays inside the viewport
      await page.mouse.move(
        southEast.x + southEast.width / 2 - 120,
        southEast.y + southEast.height / 2 - 90,
        { steps: 6 }
      )
      await page.mouse.up()
      await page.waitForTimeout(400)
      const afterResize = await page.evaluate(() => window.coc.window.getBounds())
      expect(afterResize.width).toBeLessThan(beforeResize.width)
      expect(afterResize.height).toBeLessThan(beforeResize.height)
      await page.evaluate((bounds) => window.coc.window.setBounds(bounds), beforeResize)
      await page.waitForTimeout(300)
    }
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
    await expect(page.getByRole('button', { name: /林恩/ })).toBeVisible()
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
