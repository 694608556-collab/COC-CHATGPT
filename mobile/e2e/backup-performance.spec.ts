import { expect, test } from '@playwright/test'
import { searchSample } from '../src/dev/sample'
import { readFile } from 'node:fs/promises'

test('完整大正文备份不中断界面响应，保存后可重新预览全部正文', async ({ page }) => {
  test.setTimeout(120000)
  const sample = searchSample()
  sample.modules = [sample.modules[0]!]
  sample.characters = []
  sample.records = [
    {
      ...sample.records[0]!,
      rawContent: {
        parserVersion: 1,
        messages: Array.from({ length: 16000 }, (_, i) => ({
          ...sample.records[0]!.rawContent!.messages[0]!,
          id: `public-backup-${i}`,
          order: i,
          text: `公开完整正文 ${i} ` + '调查员记录完整探索，不删减正文。'.repeat(20)
        }))
      }
    }
  ]
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await chooser
  ).setFiles({
    name: 'public-backup-performance.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成', { timeout: 30000 })
  await page.reload()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.evaluate(() => {
    let last = performance.now()
    Object.assign(window, {
      backupGaps: [] as number[],
      backupTimer: setInterval(() => {
        const now = performance.now()
        ;(window as unknown as { backupGaps: number[] }).backupGaps.push(now - last)
        last = now
      }, 16)
    })
  })
  await page.getByRole('button', { name: '保存安卓备份', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('备份已保存并回读校验', { timeout: 60000 })
  const gap = await page.evaluate(() => {
    const measured = window as unknown as { backupGaps: number[]; backupTimer: number }
    clearInterval(measured.backupTimer)
    return Math.max(...measured.backupGaps)
  })
  expect(gap).toBeLessThan(500)
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await page.getByText('测试文件（1）', { exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^[0-9]{8}COC跑团记录簿[0-9]*\.json$/ }).click()
  const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  expect(saved.snapshot.records[0].rawContent.messages).toEqual(sample.records[0]!.rawContent!.messages)
})
