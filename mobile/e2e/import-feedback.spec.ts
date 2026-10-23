import { expect, test } from '@playwright/test'
import { publicTableStreamCSV } from '../src/dev/table-stream-fixture'

test('导入反馈帧前取消不打开文件来源、不提交或残留租约', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept())
  await page.goto('/?table-stream-fixture')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const before = await page.evaluate(() => window.__publicTableStreamFixture!.state())
  await page.evaluate(async () => {
    const button = Array.from(document.querySelectorAll('button')).find(node => node.textContent?.trim() === '导入场次表格')!
    button.click()
    // The operation owns its controller now, but the first paint has not run.
    await Promise.resolve()
    window.dispatchEvent(new Event('logbook-back'))
  })
  await page.getByRole('button', { name: '导入场次表格', exact: true }).waitFor()
  await expect(page.getByRole('button', { name: '导入场次表格', exact: true })).toBeEnabled()
  const result = await page.evaluate(async () => ({
    state: await window.__publicTableStreamFixture!.state(),
    stats: window.__publicTableStreamFixture!.stats
  }))
  expect(result.stats.opened).toBe(0)
  expect(result.stats.commits).toBe(0)
  expect(result.stats.active).toBe(false)
  expect(result.state).toEqual(before)
  await expect(page.getByRole('dialog', { name: '表格导入预览' })).toHaveCount(0)
  await expect(page.getByRole('progressbar')).toHaveCount(0)
})

test('首次和再次导入均先绘制禁用反馈，再进入较慢的文件提供器，完整预览仍在600ms内', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.route('**/_capacitor_file_/public-table-stream.csv**', (route) =>
    route.fulfill({
      contentType: 'text/csv; charset=utf-8',
      body: publicTableStreamCSV(1)
    })
  )
  await page.goto('/?table-stream-fixture')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.evaluate(() => {
    const fixture = window.__publicTableStreamFixture!
    fixture.options.rows = 1
    const button = Array.from(document.querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === '导入场次表格'
    )!
    const probe = { start: 0, responseMs: 0, providerMs: 0, totalMs: 0, queued: false }
    Object.assign(window, { __importPaintProbe: probe })
    button.addEventListener(
      'click',
      () => {
        Object.assign(probe, {
          start: performance.now(),
          responseMs: 0,
          providerMs: 0,
          totalMs: 0,
          queued: false
        })
      },
      true
    )
    Object.defineProperty(fixture.options, 'pickerDelayMs', {
      get() {
        probe.providerMs = performance.now() - probe.start
        // Exercise the real UI/Worker path with a deterministic busy provider task.
        const until = performance.now() + 180
        while (performance.now() < until) {}
        return 0
      }
    })
    new MutationObserver(() => {
      if (!probe.start) return
      if (button.disabled && !probe.queued) {
        probe.queued = true
        const start = probe.start
        requestAnimationFrame(() => {
          if (probe.start === start) probe.responseMs = performance.now() - start
        })
      }
      if (!probe.totalMs && document.querySelector('[role="dialog"][aria-label="表格导入预览"]'))
        probe.totalMs = performance.now() - probe.start
    }).observe(document.body, {
      attributes: true,
      attributeFilter: ['disabled'],
      subtree: true,
      childList: true
    })
  })
  for (let repeat = 0; repeat < 2; repeat++) {
    await page.getByRole('button', { name: '导入场次表格', exact: true }).click()
    const preview = page.getByRole('dialog', { name: '表格导入预览' })
    await expect(preview).toContainText('公开完整场次0')
    const timing = await page.evaluate(() => (window as any).__importPaintProbe)
    expect(timing.responseMs).toBeGreaterThan(0)
    expect(timing.responseMs).toBeLessThanOrEqual(100)
    expect(timing.providerMs).toBeGreaterThanOrEqual(timing.responseMs)
    expect(timing.totalMs).toBeLessThanOrEqual(600)
    await preview.getByRole('button', { name: '取消', exact: true }).click()
    await expect(preview).toHaveCount(0)
  }
})

test('选择文件期间不出现应用导入弹窗或进度；快速预览不闪阻塞弹窗', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.route('**/_capacitor_file_/public-table-stream.csv**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/csv; charset=utf-8',
      body:
        '模组名,场次名,海豹链接,手动保存内容,KP1,PC1,PL1\r\n' +
        [
          '公开流式团',
          '公开完整场次0',
          '',
          '公开完整正文 0\n保留逗号,引号"和😀末尾',
          '公开KP',
          '公开PC',
          '公开PL'
        ]
          .map((value) => '"' + value.replace(/"/g, '""') + '"')
          .join(',')
    })
  )
  await page.goto('/?table-stream-fixture')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.evaluate(() => {
    window.__publicTableStreamFixture!.options.pickerDelayMs = 2000
    window.__publicTableStreamFixture!.options.rows = 1
    ;(window as unknown as { importBlockingDialogs: string[] }).importBlockingDialogs = []
    new MutationObserver(() => {
      for (const dialog of document.querySelectorAll('[role="dialog"][aria-label="正在导入表格"]'))
        (window as unknown as { importBlockingDialogs: string[] }).importBlockingDialogs.push(
          dialog.textContent || ''
        )
    }).observe(document.body, { childList: true, subtree: true })
  })
  await page.getByRole('button', { name: '导入场次表格', exact: true }).click()
  expect(await page.getByRole('dialog', { name: '正在导入表格' }).count()).toBe(0)
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => window.__publicTableStreamFixture!.stats.opened)).toBe(0)
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: '表格导入预览' })).toBeVisible()
  expect(
    await page.evaluate(
      () => (window as unknown as { importBlockingDialogs: string[] }).importBlockingDialogs
    )
  ).toEqual([])
})

for (const gesture of [false, true])
  test(
    gesture
      ? 'iOS无页头返回按钮时，边缘手势取消慢速导入仍释放租约且不写库'
      : '慢速实际Worker导入只显示一处非模态进度，取消仍释放租约且不写入',
    async ({ page }) => {
      page.on('dialog', (dialog) => dialog.accept())
      await page.goto('/?table-stream-fixture')
      await page.getByRole('button', { name: '选择并确认保存位置' }).click()
      await page.getByRole('button', { name: '数据与设置', exact: true }).click()
      if (gesture) await page.locator('.app-back').evaluate((node) => node.remove())
      const before = await page.evaluate(() => window.__publicTableStreamFixture!.state())
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      await page.route('**/_capacitor_file_/public-table-stream.csv**', async (route) => {
        await gate
        await route.abort().catch(() => {})
      })
      try {
        await page.getByRole('button', { name: '导入场次表格', exact: true }).click()
        await expect(page.getByRole('progressbar', { name: '导入处理进度' })).toBeVisible()
        expect(await page.getByRole('button', { name: '取消导入', exact: true }).count()).toBe(0)
        await expect(page.getByRole('progressbar')).toHaveCount(1)
        expect(await page.getByRole('dialog', { name: '正在导入表格' }).count()).toBe(0)
        if (gesture) {
          await expect(page.locator('.app-back')).toHaveCount(0)
          const client = await page.context().newCDPSession(page)
          await client.send('Emulation.setTouchEmulationEnabled', { enabled: true })
          await client.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: 3, y: 320, id: 0 }]
          })
          for (let step = 1; step <= 8; step++)
            await client.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{ x: 3 + step * 12, y: 320, id: 0 }]
            })
          await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        } else await page.evaluate(() => window.dispatchEvent(new Event('logbook-back')))
        await expect
          .poll(() => page.evaluate(() => window.__publicTableStreamFixture!.stats.cancellations))
          .toBe(1)
        expect(await page.evaluate(() => window.__publicTableStreamFixture!.state())).toEqual(before)
        await expect(page.getByRole('progressbar')).toHaveCount(0)
        await expect(page.getByRole('dialog', { name: '表格导入预览' })).toHaveCount(0)
      } finally {
        release()
      }
    }
  )
