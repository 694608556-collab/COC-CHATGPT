import { acceptAppConfirmations } from './helpers'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { expandModules } from './helpers'
import { searchSample } from '../src/dev/sample'
import { createEmptyCharacter } from '../../src/shared/coc-rules'

async function ready(page: Page) {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.locator('[data-module-toggle]')).toHaveCount(2)
  await page.getByLabel('显示鼠标手势辅助').uncheck()
}

test('紧凑标题、无粗紫焦点框、模组内新增归属及多选提醒末尾', async ({ page }, info) => {
  await ready(page)
  await expect(page.locator('.app-header .operation-feedback')).toHaveCount(0)
  expect((await page.locator('.app-header').boundingBox())!.height).toBeLessThan(76)
  for (const name of ['角色卡', '数据与设置', '跑团记录']) {
    const nav = page.locator('.bottom-nav').getByRole('button', { name, exact: true })
    await nav.click()
    expect(await nav.evaluate((node) => getComputedStyle(node).outlineWidth)).toBe('0px')
  }
  await expect(page.getByRole('button', { name: '新增手动场次' })).toHaveCount(0)
  await expandModules(page)
  await expect(page.getByRole('button', { name: '重排场次序号' })).toHaveCount(0)
  const group = page.locator('.module-group').filter({ hasText: '山间旅馆' })
  expect(
    await group
      .locator(':scope > .gesture-row .drag-handle')
      .evaluate((node) => node.getBoundingClientRect().width)
  ).toBe(30)
  await group.getByRole('button', { name: '新增手动场次' }).click()
  await expect(page.getByRole('combobox', { name: '所属模组', exact: true })).toContainText('山间旅馆')
  await page.getByLabel('场次名称', { exact: true }).fill('归属第二模组的手动场次')
  await page.getByLabel('手动正文', { exact: true }).fill('公开测试内容')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expandModules(page)
  await expect(group.locator('.record-card').filter({ hasText: '归属第二模组' })).toBeVisible()
  await group.getByRole('button', { name: '新增在线场次' }).click()
  await expect(page.getByRole('combobox', { name: '所属模组', exact: true })).toContainText('山间旅馆')
  await page.getByRole('button', { name: '取消编辑' }).click()
  await expandModules(page)
  await group.getByRole('button', { name: '全选此模组' }).click()
  await expect(group.locator('.module-actions > :last-child')).toHaveClass('selection-count')
  const count = (await group.locator('.selection-count').boundingBox())!
  expect(
    await group
      .locator('.module-actions button')
      .evaluateAll((nodes, y) => nodes.every((node) => node.getBoundingClientRect().bottom <= y), count.y)
  ).toBe(true)
  await page.screenshot({ path: info.outputPath('compact-records-selection.png') })
})

test('正文点击和搜索定位用紫色圆角细边框，切换后原条目恢复灰边且正文不变', async ({ page }, info) => {
  await ready(page)
  await expandModules(page)
  await page.locator('[data-drag-id="demo-long"] .record-card').click()
  const first = page.locator('[data-message-index="0"]')
  const second = page.locator('[data-message-index="1"]')
  const original = await first.textContent()
  await first.click()
  await expect(first).toBeFocused()
  expect(
    await first.evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        outline: style.outlineWidth,
        border: style.borderColor,
        width: style.borderWidth,
        radius: style.borderRadius
      }
    })
  ).toEqual({ outline: '0px', border: 'rgb(109, 69, 245)', width: '1px', radius: '10px' })
  await second.click()
  await expect(second).toBeFocused()
  expect(await first.evaluate((node) => getComputedStyle(node).borderColor)).toBe('rgb(211, 215, 222)')
  const query = page.getByRole('searchbox', { name: '搜索整场正文' })
  await query.fill('灯塔')
  await query.press('Enter')
  const target = page.locator('.search-target')
  await expect(target).toBeFocused()
  expect(await target.evaluate((node) => getComputedStyle(node).borderColor)).toBe('rgb(109, 69, 245)')
  await first.click()
  await expect(first).toBeFocused()
  expect(await target.evaluate((node) => getComputedStyle(node).borderColor)).toBe('rgb(211, 215, 222)')
  await page.getByRole('button', { name: '清空正文搜索' }).click()
  await expect(first).toHaveText(original!)
  await first.click()
  await first.screenshot({ path: info.outputPath('purple-message-selection.png') })
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.getByRole('button', { name: '深色模式', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存安卓备份', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await expandModules(page)
  await page.locator('[data-drag-id="demo-long"] .record-card').click()
  await first.click()
  expect(await first.evaluate((node) => getComputedStyle(node).borderColor)).toBe('rgb(156, 133, 255)')
})

test('中文链接状态、末尾日期、紧凑操作栏与导出格式键盘菜单', async ({ page }, info) => {
  await ready(page)
  await expandModules(page)
  await expect(page.locator('[data-drag-id="demo-long"] .record-status-text')).toHaveText(
    '序号 1 · 有效 · 跑团时间：2026-10-13'
  )
  await expect(page.locator('[data-drag-id="demo-missing"] .record-status')).toContainText('未检测')
  await expect(page.locator('[data-drag-id="demo-manual"] .record-status')).toContainText('手动内容')
  await page.locator('[data-drag-id="demo-long"] .record-card').click()
  const actions = page.locator('.reader-actions')
  expect(await actions.evaluate((node) => getComputedStyle(node).justifyContent)).toBe('flex-start')
  await expect(page.getByLabel('隐藏骰指令')).toHaveCount(0)
  await expect(page.getByLabel('隐藏题外话')).toHaveCount(0)
  await expect(page.getByLabel('隐藏时间', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '搜索', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '清除搜索', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '清空正文搜索' })).toHaveCount(0)
  const query = page.getByRole('searchbox', { name: '搜索整场正文' })
  await query.fill('灯塔')
  await query.press('Enter')
  await expect(page.locator('.search-target')).toBeFocused()
  expect(await page.locator('.search-target').evaluate((node) => getComputedStyle(node).outlineWidth)).toBe(
    '0px'
  )
  await page.getByRole('button', { name: '清空正文搜索' }).click()
  await expect(query).toHaveValue('')
  await expect(page.locator('.search-target')).toHaveCount(0)
  await page.getByRole('button', { name: '更多导出格式' }).click()
  const trigger = page.getByRole('combobox', { name: '文件格式', exact: true })
  await trigger.press('ArrowDown')
  await expect(page.getByRole('option', { name: 'TXT', exact: true })).toBeFocused()
  await expect(page.getByRole('option')).toHaveCount(6)
  for (const label of ['原始 JSON', 'TXT', '带图 DOC', '纯对话 DOC', 'DOCX', 'PDF'])
    await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('styled-export-menu.png') })
  await page.keyboard.press('End')
  await expect(page.getByRole('option', { name: 'PDF', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveText('PDF▾')
  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('物品两三列自适应，技能灰细框及装备背景中文标签不改数据', async ({ page }, info) => {
  await ready(page)
  const sample = searchSample()
  const character = createEmptyCharacter({ edition: 7, name: '中文展示测试' })
  character.items = ['钱包', '卫生纸', '刀', '一件非常长且需要自动换行的公开测试物品']
  character.weapons = [{ name: '马格南', damage: '1D6' }]
  character.background = {
    description: '公开描述',
    belief: '公开信念',
    importantPerson: '公开联系人',
    significantPlace: '公开地点',
    自定义背景: '保留自定义内容'
  }
  sample.characters = [character]
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await chooser
  ).setFiles({
    name: 'public-character.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: /中文展示测试/ }).click()
  const weapons = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: '武器', exact: true }) })
  await expect(weapons.locator('.weapon-display')).toHaveText('马格南')
  await expect(weapons.locator('dl')).toHaveCount(0)
  for (const label of ['个人描述', '思想与信念', '重要之人', '意义非凡之地', '自定义背景'])
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
  const skillStyle = await page
    .locator('.skill-row')
    .first()
    .evaluate((node) => ({
      background: getComputedStyle(node).backgroundColor,
      border: getComputedStyle(node).borderWidth,
      panel: getComputedStyle(node.closest('.panel')!).backgroundColor
    }))
  expect(skillStyle.border).toBe('1px')
  expect(skillStyle.background).toBe(skillStyle.panel)
  for (const [width, columns] of [
    [280, 2],
    [360, 3],
    [430, 3]
  ]) {
    await page.setViewportSize({ width, height: 915 })
    await expect
      .poll(() =>
        page
          .locator('.items-display-grid')
          .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
      )
      .toBe(columns)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  }
  await page.screenshot({ path: info.outputPath('character-gray-skills-items.png'), fullPage: true })
  await page.getByRole('button', { name: '编辑角色卡' }).click()
  for (const [width, columns] of [
    [280, 2],
    [360, 3],
    [430, 3]
  ]) {
    await page.setViewportSize({ width, height: 915 })
    await expect
      .poll(() =>
        page
          .locator('.item-editor-grid')
          .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
      )
      .toBe(columns)
    await expect(page.getByLabel('物品4', { exact: true })).toHaveValue(character.items[3]!)
  }
  await page.getByRole('button', { name: '取消编辑' }).click()
  await expect(page.getByText('保留自定义内容', { exact: true })).toBeVisible()
})

test('清空应用数据取消及确认：原范围、设置、授权及现存归档保留，不新增副本', async ({ page }) => {
  await ready(page)
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.getByLabel('隐藏骰指令').check()
  await expect(page.getByRole('button', { name: '保存安卓备份', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '保存安卓备份', exact: true }).click()
  await expect(page.locator('.operation-feedback [role="status"]')).toContainText('备份已保存')
  await page.getByRole('button', { name: '刷新归档文件' }).click()
  const archive = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: '归档文件', exact: true }) })
  const beforeDocuments = await archive.locator('.pair-editor .source-link').allTextContents()
  expect(beforeDocuments.length).toBeGreaterThan(0)
  await expect(page.getByRole('heading', { name: '清空应用数据' })).toBeVisible()
  await expect(page.getByRole('button', { name: '清空业务数据' })).toHaveCount(0)
  const confirmation = page.getByRole('dialog', { name: '确认操作', exact: true })
  await page.removeLocatorHandler(confirmation)
  await page.getByRole('button', { name: '清空应用数据', exact: true }).click()
  await confirmation.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('region', { name: '数据统计' })).toContainText('4')
  await page.getByRole('button', { name: '清空应用数据', exact: true }).click()
  await expect(confirmation).toContainText('归档文件会保留')
  await expect(confirmation).not.toContainText('安全副本')
  await confirmation.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.locator('.operation-feedback [role="status"]')).toContainText('操作已保存')
  await expect(page.getByLabel('隐藏骰指令')).toBeChecked()
  await page.getByRole('button', { name: '刷新归档文件' }).click()
  const afterDocuments = await archive.locator('.pair-editor .source-link').allTextContents()
  expect(afterDocuments).toHaveLength(beforeDocuments.length)
  for (const document of beforeDocuments) expect(afterDocuments).toContain(document)
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await expect(page.getByText('测试文件（1）', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '选择并确认保存位置' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '暂无场次' })).toBeVisible()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await expect(page.getByLabel('隐藏骰指令')).toBeChecked()
})
