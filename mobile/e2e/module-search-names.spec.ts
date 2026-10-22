import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { searchSample } from '../src/dev/sample'
import { createEmptyCharacter } from '../../src/shared/coc-rules'
import { acceptAppConfirmations, expandModules } from './helpers'

async function ready(page: Page, sample = searchSample()) {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const choose = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await choose
  ).setFiles({
    name: 'public-search-names.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
}

test('公开英文姓名候选连续点击和焦点切换保留精确值及重启保存值，并保留事件证据', async ({ page }, info) => {
  const swift = await readFile(new URL('../ios/App/App/LogbookViewController.swift', import.meta.url), 'utf8')
  const script = swift.match(/static let script = #"""([\s\S]*?)"""#/)![1]!
  await page.addInitScript(
    `window.__nameEvents=[];window.webkit={messageHandlers:{cocPublicNameTrace:{postMessage(value){window.__nameEvents.push(value)}}}};${script}`
  )
  const sample = searchSample()
  sample.modules[0]!.pairs = [
    { pc: 'Public Alpha', pl: 'Fixture A' },
    { pc: 'Public Beta', pl: 'Fixture B' }
  ]
  await ready(page, sample)
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: '新建七版角色' }).click()
  await page.getByRole('checkbox', { name: sample.modules[0]!.name, exact: true }).check()
  const input = page.getByLabel('姓名', { exact: true })
  const menu = page.getByRole('listbox', { name: '模组PC姓名候选' })
  await menu.getByRole('option', { name: 'Public Beta', exact: true }).click()
  await expect(input).toHaveValue('Public Beta')
  for (let cycle = 0; cycle < 6; cycle++) {
    for (const name of ['Public Alpha', 'Public Beta', 'Public Beta', 'Public Alpha']) {
      await input.click()
      await menu.getByRole('option', { name, exact: true }).click()
      await expect(input).toHaveValue(name)
    }
    await page.getByLabel('职业', { exact: true }).click()
    await input.click()
    await expect(input).toHaveValue('Public Alpha')
  }
  const events = await page.evaluate(
    () =>
      (
        window as unknown as {
          __nameEvents: Array<{ kind: string; event?: string; option?: { value: string } }>
        }
      ).__nameEvents
  )
  expect(events.some((e) => e.event === 'click' && e.option?.value === 'Public Beta')).toBe(true)
  expect(events.some((e) => e.event === 'focusout')).toBe(true)
  await info.attach('public-name-dom-events.json', {
    body: JSON.stringify(events, null, 2),
    contentType: 'application/json'
  })
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.editor')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: /^Public Alpha/ }).click()
  await page.getByRole('button', { name: '编辑角色卡', exact: true }).click()
  await expect(page.getByLabel('姓名', { exact: true })).toHaveValue('Public Alpha')
})

test('模组正文搜索替代名称搜索，跨场次结果跳转与清空，其他模组不串结果', async ({ page }, info) => {
  const sample = searchSample()
  sample.records[0]!.rawContent!.messages[204]!.text += ' 跨页唯一路标'
  await ready(page, sample)
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await expandModules(page)
  await expect(page.getByText('搜索模组或场次', { exact: true })).toHaveCount(0)
  const module = page.locator('.module-group').filter({ hasText: sample.modules[0]!.name })
  const input = module.getByPlaceholder('搜索该模组所有场次正文')
  expect(await input.evaluate((node) => getComputedStyle(node).borderRadius)).toBe('9px')
  expect(await input.evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe('1px')
  const searchBox = (await input.boundingBox())!,
    actions = (await module.getByRole('button', { name: '全选此模组', exact: true }).boundingBox())!
  expect(searchBox.y + searchBox.height).toBeLessThan(actions.y)
  await page.screenshot({ path: info.outputPath('module-search-restyled-light.png') })
  await input.fill('灯塔')
  await input.press('Enter')
  const results = module.getByRole('region', { name: '模组正文搜索结果' })
  await expect(results.locator('.search-result')).toHaveCount(2)
  await page.screenshot({ path: info.outputPath('module-body-search.png') })
  await input.fill('跨页唯一路标')
  await input.press('Enter')
  await results.getByRole('button', { name: /第一场/ }).click()
  await expect(page.getByLabel('搜索整场正文')).toHaveValue('跨页唯一路标')
  await expect(page.locator('.message.search-target')).toHaveAttribute('data-message-index', '204')
  await expect(page.locator('.message.search-target')).toBeFocused()
  await expect(page.locator('.pagination[aria-label="正文分页"]')).toContainText('3 / 3')
  await page.evaluate(() => window.dispatchEvent(new Event('logbook-back')))
  await expect(page.getByRole('button', { name: '编辑场次', exact: true })).toHaveCount(0)
  await expect(page.locator('[data-record-id="demo-long"]')).toHaveAttribute('aria-current', 'true')
  await expect(input).toHaveValue('跨页唯一路标')
  await module.getByRole('button', { name: '清空模组正文搜索' }).click()
  await expect(input).toHaveValue('')
  await expect(results).toHaveCount(0)
  await input.fill('铜钥匙')
  await input.press('Enter')
  await results.getByRole('button', { name: /第二场/ }).click()
  await expect(page.locator('.message.search-target')).toContainText('铜钥匙')
  await page.getByRole('button', { name: '返回场次', exact: true }).click()
  await expect(page.locator('[data-record-id="demo-manual"]')).toHaveAttribute('aria-current', 'true')
  await expandModules(page)
  const other = page.locator('.module-group').filter({ hasText: sample.modules[1]!.name })
  await other.getByPlaceholder('搜索该模组所有场次正文').fill('铜钥匙')
  await other.getByPlaceholder('搜索该模组所有场次正文').press('Enter')
  await expect(other.getByRole('region', { name: '模组正文搜索结果' })).toContainText('没有找到匹配正文')
  await input.fill('a+b')
  await input.press('Enter')
  await expect(results.locator('.search-result')).toHaveCount(1)
  await input.fill('骰子专用词')
  await input.press('Enter')
  await expect(results.locator('.search-result')).toHaveCount(1)
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.getByLabel('隐藏骰指令').check()
  await expect(page.getByRole('button', { name: '保存安卓备份', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await expect(module.getByRole('region', { name: '模组正文搜索结果' })).toContainText('没有找到匹配正文')
  for (const width of [280, 412, 840]) {
    await page.setViewportSize({ width, height: 915 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  }
  await page.setViewportSize({ width: 412, height: 915 })
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.getByRole('button', { name: '深色模式', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存安卓备份', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await input.fill('')
  await input.press('Tab')
  await page.screenshot({ path: info.outputPath('module-search-restyled-dark.png') })
  expect(await input.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
    await module.evaluate((node) => getComputedStyle(node).backgroundColor)
  )
})

test('已选模组 PC 姓名候选去重、键盘选择，关联改名及取消关联不写入模组参与者', async ({ page }, info) => {
  const sample = searchSample()
  const original = createEmptyCharacter({ edition: 7, name: '原角色' })
  sample.characters = [original]
  sample.modules[0]!.pairs = [
    { pc: '林', pl: '原玩家', characterId: original.id },
    { pc: '陈', pl: '玩家二' },
    { pc: '林', pl: '玩家三' }
  ]
  sample.modules[1]!.pairs = [{ pc: '周', pl: '玩家四' }]
  await ready(page, sample)
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: '新建七版角色' }).click()
  await page.getByLabel('姓名', { exact: true }).click()
  await expect(page.getByRole('listbox', { name: '模组PC姓名候选' })).toHaveCount(0)
  await page.getByRole('checkbox', { name: sample.modules[0]!.name, exact: true }).check()
  await page.getByLabel('姓名', { exact: true }).click()
  const names = page.getByRole('listbox', { name: '模组PC姓名候选' })
  await expect(names.getByRole('option')).toHaveText(['林', '陈'])
  await page.screenshot({ path: info.outputPath('pc-name-candidates.png') })
  await page.getByLabel('姓名', { exact: true }).press('ArrowDown')
  await page.getByLabel('姓名', { exact: true }).press('Enter')
  await expect(page.getByLabel('姓名', { exact: true })).toHaveValue('林')
  await page.getByRole('checkbox', { name: sample.modules[1]!.name, exact: true }).check()
  await page.getByLabel('姓名', { exact: true }).click()
  await expect(names.getByRole('option')).toHaveText(['林', '陈', '周'])
  await names.getByRole('option', { name: '周', exact: true }).click()
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.editor')).toHaveCount(0)
  await page.getByRole('button', { name: /^周/ }).click()
  await page.getByRole('button', { name: '编辑角色卡', exact: true }).click()
  for (const module of sample.modules)
    await page.getByRole('checkbox', { name: module.name, exact: true }).uncheck()
  await page.getByLabel('姓名', { exact: true }).fill('独立角色姓名')
  await expect(names).toHaveCount(0)
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.editor')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.getByRole('button', { name: '保存安卓备份', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('备份已保存')
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await page.getByText(/测试文件（/).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^coc-android-backup-.*\.json$/ }).click()
  const saved = JSON.parse((await readFile((await (await download).path())!)).toString()).snapshot
  expect(saved.modules).toEqual(sample.modules)
  expect(saved.records).toEqual(sample.records)
  expect(
    saved.characters.find((c: { basic: { name: string } }) => c.basic.name === '独立角色姓名').moduleIds
  ).toEqual([])
  const icon = page.getByRole('button', { name: '跑团记录', exact: true }).locator('svg')
  await expect(icon.locator('rect')).toHaveAttribute('rx', '3')
  await expect(icon.locator('path')).toHaveAttribute('d', 'M9 8h6M9 12h6M9 16h6')
})
