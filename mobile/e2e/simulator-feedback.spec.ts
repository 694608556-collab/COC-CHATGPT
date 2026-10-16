import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { searchSample } from '../src/dev/sample'
import { createEmptyCharacter } from '../../src/shared/coc-rules'
import { acceptAppConfirmations, expandModules } from './helpers'

async function ready(page: Page) {
  const sample = searchSample()
  sample.modules[0]!.name = '模组甲'
  sample.records[0]!.name = '第 4 场'
  sample.records[0]!.playDate = '2026-05-06'
  const character = createEmptyCharacter({ edition: 7, name: '公开角色' })
  character.story = '公开经历第一行\n第二行仍保留\n第三行\n第四行需要滚动查看'
  sample.characters = [character]
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await chooser
  ).setFiles({
    name: 'public-simulator-feedback.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
  return sample
}

test('角色编辑框紧凑且无缩放小点，长文字保存重开不丢失；阅读卡片保留原字体', async ({ page }, info) => {
  const sample = await ready(page)
  await page.setViewportSize({ width: 320, height: 760 })
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: /^公开角色/ }).click()
  await page.getByRole('button', { name: '编辑角色卡', exact: true }).click()
  const story = page.getByRole('textbox', { name: '调查员经历', exact: true })
  await expect(story).toHaveValue(sample.characters[0]!.story)
  expect(await story.evaluate((el) => getComputedStyle(el).resize)).toBe('none')
  expect((await story.boundingBox())!.height).toBeLessThan(82)
  expect((await page.getByLabel('姓名', { exact: true }).boundingBox())!.height).toBeLessThanOrEqual(34)
  expect((await page.getByRole('button', { name: '保存修改', exact: true }).boundingBox())!.height).toBe(30)
  await story.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('compact-character.png') })
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.editor')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: /^公开角色/ }).click()
  await expect(page.getByText(sample.characters[0]!.story, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await expandModules(page)
  await page.locator('[data-drag-id="demo-long"] .record-card').click()
  const message = page.locator('.message').first()
  expect(await message.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('10px')
  expect(await message.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('SF Pro Text')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  await message.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: info.outputPath('compact-reader.png') })
})

test('实际导出与电脑同名，重复保存保留旧文件，合成和表格 ZIP 同规则，过滤说明首句加粗', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-16T04:00:00Z'))
  await ready(page)
  await expandModules(page)
  await page.locator('[data-drag-id="demo-long"] .record-card').click()
  const recent = page.locator('.recent-saved-title')
  await page.getByRole('button', { name: '导出 TXT', exact: true }).click()
  await expect(recent).toContainText('20260506模组甲第 4 场.txt')
  await page.getByRole('button', { name: '导出 TXT', exact: true }).click()
  await expect(recent).toContainText('20260506模组甲第 4 场 (2).txt')
  await page.getByRole('button', { name: '更多导出格式', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导出日志', exact: true })
  const emphasis = dialog.getByText('按当前过滤设置导出。', { exact: true })
  expect(await emphasis.evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '返回场次', exact: true }).click()
  await expandModules(page)
  const group = page.locator('.module-group').filter({ hasText: '模组甲' })
  await group.getByRole('button', { name: '全选此模组', exact: true }).click()
  await group.getByRole('button', { name: '合成导出', exact: true }).click()
  await dialog.getByRole('button', { name: '保存导出文件', exact: true }).click()
  await expect(recent).toContainText('20261016模组甲合集.txt')
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.getByRole('button', { name: '导出记录 Excel', exact: true }).click()
  await expect(recent).toContainText('COC跑团记录20261016.xlsx')
  await page.getByRole('button', { name: /导出记录 CSV/ }).click()
  await expect(recent).toContainText('COC跑团记录20261016.zip')
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await page.getByText('测试文件（5）', { exact: true }).click()
  const saved: Buffer[] = []
  for (const name of [
    '20260506模组甲第 4 场.txt',
    '20260506模组甲第 4 场 (2).txt',
    'COC跑团记录20261016.zip'
  ]) {
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name, exact: true }).click()
    saved.push(await readFile((await (await download).path())!))
  }
  expect(saved[1]).toEqual(saved[0])
  expect(saved[0]!.toString('utf8')).toContain('铜钥匙')
  expect(Object.keys(unzipSync(saved[2]!))).toEqual(['模组甲.csv', '山间旅馆（公开测试）.csv'])
})
