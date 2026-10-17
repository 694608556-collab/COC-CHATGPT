import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
import { searchSample } from '../src/dev/sample'
import { expandModules } from './helpers'

test('大正文合成 DOCX 不长时间阻塞界面，并保留两个场次的首尾正文', async ({ page }) => {
  test.setTimeout(120000)
  const sample = searchSample()
  sample.modules = [{ ...sample.modules[0]!, name: '公开导出性能回归' }]
  sample.records = Array.from({ length: 2 }, (_, i) => ({
    ...sample.records[0]!,
    id: 'export-public-' + i,
    name: '公开场次 ' + (i + 1),
    order: i,
    rawContent: {
      parserVersion: 1,
      messages: Array.from({ length: 12000 }, (_, j) => ({
        ...sample.records[0]!.rawContent!.messages[0]!,
        id: `${i}-${j}`,
        order: j,
        text: `场次 ${i + 1} 第 ${j + 1} 条：调查员记录完整探索，不删减正文。`
      }))
    }
  }))
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await chooser
  ).setFiles({
    name: 'public-export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成', { timeout: 30000 })
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await expandModules(page)
  await page.getByRole('button', { name: '全选此模组', exact: true }).click()
  await page.getByRole('button', { name: '合成导出', exact: true }).click()
  await page.getByRole('combobox', { name: '文件格式', exact: true }).click()
  await page.getByRole('option', { name: 'DOCX', exact: true }).click()
  await page.evaluate(() => {
    const gaps: number[] = []
    let last = performance.now()
    Object.assign(window, {
      exportGaps: gaps,
      exportTimer: setInterval(() => {
        const now = performance.now()
        gaps.push(now - last)
        last = now
      }, 16)
    })
  })
  await page.getByRole('button', { name: '保存导出文件' }).click()
  await expect(page.getByRole('status')).toContainText('1 个文件', { timeout: 60000 })
  const gap = await page.evaluate(() => {
    const measured = window as unknown as { exportTimer: number; exportGaps: number[] }
    clearInterval(measured.exportTimer)
    return Math.max(...measured.exportGaps)
  })
  expect(gap).toBeLessThan(500)
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await page.getByText('测试文件（1）', { exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /公开导出性能回归.*\.docx$/ }).click()
  const bytes = await readFile((await (await download).path())!)
  const xml = strFromU8(unzipSync(bytes)['word/document.xml']!)
  for (const index of [1, 2])
    for (const line of [1, 12000])
      expect(xml).toContain(`场次 ${index} 第 ${line} 条：调查员记录完整探索，不删减正文。`)
})
