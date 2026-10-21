import { expect, test } from '@playwright/test'
import { acceptAppConfirmations } from './helpers'
import type { TableConfirmTiming } from '../src/data/table-timing'

test('300模组6000场后台导入、分批预览、取消及完整保存重开', async ({ page }, info) => {
  test.setTimeout(90000)
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/?table-timing')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const lines = ['模组名,场次名,海豹链接,手动保存内容']
  for (let i = 0; i < 6000; i++)
    lines.push(
      `公开导入模组${Math.floor(i / 20)},公开场次${i},https://log.weizaima.com/?key=table-scale-${i},`
    )
  const file = { name: 'public-6000.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n')) }
  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await page.evaluate(() => {
    window.addEventListener(
      'change',
      () => {
        const state = { last: performance.now(), max: 0, count: 0, running: true }
        ;(window as unknown as { tableFrames: typeof state }).tableFrames = state
        /** @param now 动画帧毫秒时间。@returns 无返回值，仅记录预览期间界面响应。 */
        function frame(now: number) {
          if (!state.running) return
          state.max = Math.max(state.max, now - state.last)
          state.last = now
          state.count++
          requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      },
      { capture: true, once: true }
    )
  })
  let chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入场次表格', exact: true }).click()
  await (await chooser).setFiles(file)
  const dialog = page.getByRole('dialog', { name: '表格导入预览' })
  await expect(dialog).toContainText('新增 6000 项', { timeout: 30000 })
  const frames = await page.evaluate(() => {
    const state = (window as unknown as { tableFrames: { running: boolean; max: number; count: number } })
      .tableFrames
    state.running = false
    return { max: state.max, count: state.count }
  })
  expect(frames.max).toBeLessThan(350)
  expect(frames.count).toBeGreaterThan(2)
  await info.attach('public-table-frames.json', {
    body: JSON.stringify(frames),
    contentType: 'application/json'
  })
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await expect(dialog.locator('.dialog-body > p')).toHaveCount(101)
  await dialog.getByRole('button', { name: '显示更多场次（剩余 5900 项）', exact: true }).click()
  await expect(dialog.locator('.dialog-body > p')).toHaveCount(201)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('region', { name: '数据统计' })).toContainText('0')
  chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入场次表格', exact: true }).click()
  await (await chooser).setFiles(file)
  await expect(dialog).toContainText('新增 6000 项')
  await expect(dialog.locator('.dialog-body > p')).toHaveCount(101)
  await dialog.getByRole('button', { name: '确认添加表格数据', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('region', { name: '数据统计' })).toContainText('6000')
  const timing = await page.evaluate(
    () => (window as unknown as { __publicTableTimings: TableConfirmTiming[] }).__publicTableTimings[0]!
  )
  expect(timing.clock).toBe('webview-monotonic')
  expect(timing.worker?.clock).toBe('worker-monotonic')
  expect(timing.native).toBeUndefined() // IndexedDB is not a native device measurement.
  expect(timing.totalMs).toBeGreaterThanOrEqual(timing.prepareRoundTripMs + timing.bridgeRoundTripMs)
  expect(timing.prepareRoundTripMs).toBeGreaterThanOrEqual(timing.worker!.totalMs)
  expect(Object.values(timing.worker!.phasesMs).every((ms) => Number.isFinite(ms) && ms >= 0)).toBe(true)
  await info.attach('public-table-confirm-browser-timing.json', {
    body: JSON.stringify({ environment: 'host Edge, real Worker, IndexedDB adapter', timing }),
    contentType: 'application/json'
  })
  await page.reload()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await expect(page.getByRole('region', { name: '数据统计' })).toContainText('6000')
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await page.getByRole('button', { name: '模组 公开导入模组299', exact: true }).click()
  await expect(page.locator('.record-card').filter({ hasText: '公开场次5999' })).toBeVisible()
})
