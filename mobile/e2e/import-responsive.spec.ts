import { expect, test } from '@playwright/test'
import { searchSample } from '../src/dev/sample'

test('大备份预览期间动画持续，取消保留数据，确认后及时显示弹窗内进度', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const sample = searchSample()
  const first = sample.records[0]!
  sample.modules = [sample.modules[0]!]
  sample.records = Array.from({ length: 75 }, (_, order) => ({
    ...first,
    id: 'large-' + order,
    order,
    rawContent: {
      ...first.rawContent!,
      messages: Array.from({ length: 100 }, (_, index) => ({
        ...first.rawContent!.messages[0]!,
        id: order + '-' + index,
        text: '公开性能正文。'.repeat(12),
        raw: { text: '公开原始字段。'.repeat(5) }
      }))
    }
  }))
  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await page.evaluate(() => {
    /**
     * 文件选择完成后才开始计时，不把系统选择器暂停页面算作应用卡顿。
     * @param event - 文件输入变更事件。
     * @returns 无返回值。
     */
    function startImportFrames(event: Event) {
      if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'file') return
      const state = { last: performance.now(), max: 0, count: 0, running: true }
      ;(window as unknown as { importFrames: typeof state }).importFrames = state
      /** @param now - 动画帧时间，毫秒。 @returns 无返回值。 */
      function frame(now: number) {
        if (!state.running) return
        state.max = Math.max(state.max, now - state.last)
        state.last = now
        state.count++
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    }
    window.addEventListener('change', startImportFrames, { capture: true, once: true })
  })
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await chooser
  ).setFiles({
    name: 'public-large.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await expect(page.getByRole('dialog')).toContainText('75', { timeout: 15000 })
  const frames = await page.evaluate(() => {
    const state = (window as unknown as { importFrames: { max: number; count: number; running: boolean } })
      .importFrames
    state.running = false
    return { max: state.max, count: state.count }
  })
  expect(frames.max).toBeLessThan(350)
  expect(frames.count).toBeGreaterThan(5)
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('region', { name: '数据统计' })).toContainText('4')
  const secondChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await secondChooser
  ).setFiles({
    name: 'public-large.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await expect(page.getByRole('dialog')).toContainText('75', { timeout: 15000 })
  await page.evaluate(() => {
    /** @param event - 确认按钮点击。 @returns 无返回值；按可见绘制观察反馈延迟。 */
    function observeConfirmation(event: MouseEvent) {
      if (!(event.target instanceof Element) || event.target.textContent !== '确认覆盖并导入') return
      const start = performance.now()
      /** @returns 无返回值；只读取弹窗内已渲染的进度入口。 */
      function frame() {
        const progress = document.querySelector('.restore-dialog [role=progressbar]')
        if (progress && progress.getBoundingClientRect().height > 0) {
          ;(window as unknown as { confirmProgressMs: number }).confirmProgressMs = performance.now() - start
        } else requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    }
    window.addEventListener('click', observeConfirmation, { capture: true, once: true })
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { confirmProgressMs?: number }).confirmProgressMs),
      { timeout: 15000 }
    )
    .toBeDefined()
  expect(
    await page.evaluate(() => (window as unknown as { confirmProgressMs: number }).confirmProgressMs)
  ).toBeLessThan(250)
  await expect(page.getByRole('status')).toContainText('导入完成', { timeout: 15000 })
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await expect(page.getByRole('region', { name: '数据统计' })).toContainText('75')
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 })
})
