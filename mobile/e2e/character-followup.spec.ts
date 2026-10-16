import { acceptAppConfirmations } from './helpers'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { searchSample } from '../src/dev/sample'
import { createEmptyCharacter } from '../../src/shared/coc-rules'

async function ready(page: Page) {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.setViewportSize({ width: 393, height: 915 })
  const sample = searchSample()
  const character = createEmptyCharacter({
    edition: 7,
    name: '分区测试调查员',
    moduleIds: sample.modules.map((m) => m.id)
  })
  character.occupationFormula = '旧公式原文'
  character.derived.db = '+1D4'
  character.weapons = [
    {
      name: '马格南',
      hit: '60',
      damage: '1D6',
      range: '20米',
      times: 1,
      ammo: 6,
      durability: '10',
      自定义武器字段: '保留'
    }
  ]
  character.items = ['钱包', '卫生纸', '刀', '记录本']
  character.story = '第一段经历\n第二段经历'
  character.background = {
    description: '描述',
    treasure: '怀表',
    secret: '秘密',
    wound: '疤痕',
    phobia: '恐高',
    自定义背景: '保留'
  }
  sample.characters = [character]
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await chooser
  ).setFiles({
    name: 'public-followup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  return page.getByRole('button', { name: /分区测试调查员/ })
}

test('角色名关联多模组、武器仅名称、全背景和独立调查员经历', async ({ page }, info) => {
  const card = await ready(page)
  await expect(card.locator('.character-modules')).toHaveText('· 雾港调查（公开测试）、山间旅馆（公开测试）')
  await card.click()
  await expect(page.locator('h2 .character-modules')).toContainText('山间旅馆')
  for (const name of ['武器', '财产与装备', '背景', '调查员经历']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  }
  const weapons = page.locator('.weapon-display')
  await expect(weapons).toHaveText('马格南')
  await expect(weapons.locator('h3, dl')).toHaveCount(0)
  for (const name of [
    '个人描述',
    '思想与信念',
    '重要之人',
    '意义非凡之地',
    '宝贵之物',
    '特质',
    '难言之隐',
    '伤口和疤痕',
    '恐惧症/狂躁症',
    '自定义背景'
  ]) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  }
  const story = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: '调查员经历', exact: true }) })
  await expect(story.locator('p')).toHaveText('第一段经历\n第二段经历')
  await page.locator('.weapon-display').screenshot({ path: info.outputPath('complete-weapons.png') })
})

test('手填伤害不被属性及版次覆盖；短物品三列、长名称加宽并同步展示', async ({ page }, info) => {
  await (await ready(page)).click()
  await page.getByRole('button', { name: '编辑角色卡' }).click()
  await expect(page.getByLabel('职业技能点公式')).toHaveCount(0)
  await page.getByLabel('伤害加值', { exact: true }).fill('+2D6（自填）')
  await page.getByLabel('STR', { exact: true }).fill('90')
  await expect(page.getByLabel('伤害加值', { exact: true })).toHaveValue('+2D6（自填）')
  await page.getByRole('combobox', { name: '角色规则版次' }).click()
  await page.getByRole('option', { name: '第六版', exact: true }).click()
  await expect(page.getByLabel('伤害加值', { exact: true })).toHaveValue('+2D6（自填）')
  await page.getByRole('combobox', { name: '角色规则版次' }).click()
  await page.getByRole('option', { name: '第七版', exact: true }).click()
  const boxes = await page
    .locator('.item-edit-row')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({ y: node.getBoundingClientRect().y, width: node.getBoundingClientRect().width }))
    )
  expect(boxes[0]!.y).toBe(boxes[1]!.y)
  expect(boxes[1]!.y).toBe(boxes[2]!.y)
  const longName = '一把长度较长的公开测试武器保养工具'
  await page.getByLabel('物品4', { exact: true }).fill(longName)
  expect((await page.locator('.item-edit-row').nth(3).boundingBox())!.width).toBeGreaterThan(
    boxes[0]!.width * 2
  )
  await page.locator('.item-editor-grid').evaluate((node) => node.scrollIntoView({ block: 'center' }))
  await page
    .locator('.item-editor-grid')
    .screenshot({ path: info.outputPath('three-items-adaptive-edit.png') })
  await page.getByRole('button', { name: '保存修改' }).click()
  await page.reload()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: /分区测试调查员/ }).click()
  await expect(page.getByText('伤害加值 +2D6（自填） · 幸运 50', { exact: true })).toBeVisible()
  await expect(page.locator('.items-display-grid li').nth(3)).toHaveText(longName)
  const display = await page
    .locator('.items-display-grid li')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({ y: node.getBoundingClientRect().y, width: node.getBoundingClientRect().width }))
    )
  expect(display[0]!.y).toBe(display[1]!.y)
  expect(display[1]!.y).toBe(display[2]!.y)
  expect(display[3]!.width).toBeGreaterThan(display[0]!.width * 2)
  await page.locator('.items-display-grid').evaluate((node) => node.scrollIntoView({ block: 'center' }))
  await page
    .locator('.items-display-grid')
    .screenshot({ path: info.outputPath('three-items-adaptive-display.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(393)
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.getByRole('button', { name: '保存安卓备份', exact: true }).click()
  await expect(page.locator('.operation-feedback .notice')).toContainText('备份已保存')
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await page.getByText(/测试文件（/).click()
  const download = page.waitForEvent('download')
  await page
    .locator('.dev-banner')
    .getByRole('button', { name: /^coc-android-backup-/ })
    .click()
  const backup = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  expect(backup.snapshot.characters[0].occupationFormula).toBe('旧公式原文')
  expect(backup.snapshot.characters[0].derived.db).toBe('+2D6（自填）')
  expect(backup.snapshot.characters[0].weapons[0]).toEqual({
    name: '马格南',
    hit: '60',
    damage: '1D6',
    range: '20米',
    times: 1,
    ammo: 6,
    durability: '10',
    自定义武器字段: '保留'
  })
})

test('成功提示可关闭或三秒后渐隐；已移除备份警告，保存错误关闭不改草稿', async ({ page }) => {
  await ready(page)
  const notice = page.locator('.operation-feedback .notice')
  await expect(notice.getByRole('button', { name: '关闭提示' })).toBeVisible()
  await notice.getByRole('button', { name: '关闭提示' }).click()
  await expect(notice).toHaveCount(0)
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const warning = page.locator('.system-message.warning')
  await expect(warning).toHaveCount(0)
  await expect(page.getByRole('button', { name: '保存安卓备份', exact: true })).toBeEnabled()
  await page.getByLabel('隐藏骰指令').check()
  await expect(page.getByRole('button', { name: '保存安卓备份', exact: true })).toBeEnabled()
  await expect(notice).toHaveCount(0)
  await page.getByRole('button', { name: '保存安卓备份', exact: true }).click()
  await expect(notice).toContainText('备份已保存')
  // Capture the 300 ms fade transition rather than relying on a slow assertion poll.
  await notice.evaluate((node) => {
    const state = window as Window & { feedbackFadeSeen?: boolean }
    state.feedbackFadeSeen = false
    const observer = new MutationObserver(() => {
      if (node.classList.contains('fading')) {
        state.feedbackFadeSeen = true
        observer.disconnect()
      }
    })
    observer.observe(node, { attributes: true, attributeFilter: ['class'] })
  })
  expect(await notice.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe('0.3s')
  await expect
    .poll(() => page.evaluate(() => (window as Window & { feedbackFadeSeen?: boolean }).feedbackFadeSeen), {
      timeout: 4500,
      intervals: [50]
    })
    .toBe(true)
  await expect(notice).toHaveCount(0)
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: /分区测试调查员/ }).click()
  await page.getByRole('button', { name: '编辑角色卡' }).click()
  await page.getByLabel('姓名', { exact: true }).fill('')
  await page.getByLabel('伤害加值', { exact: true }).fill('+3D6 草稿')
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByRole('alert')).toContainText('请填写角色姓名')
  await page.getByRole('button', { name: '关闭错误提示' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByLabel('伤害加值', { exact: true })).toHaveValue('+3D6 草稿')
  await page.getByRole('button', { name: '取消编辑' }).click()
  await expect(page.getByText('伤害加值 +1D4 · 幸运 50', { exact: true })).toBeVisible()
})
