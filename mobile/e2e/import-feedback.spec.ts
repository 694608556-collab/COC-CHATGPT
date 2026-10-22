import { expect, test } from '@playwright/test'

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

test('慢速实际Worker导入只显示一处非模态进度，取消仍释放租约且不写入', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/?table-stream-fixture')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
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
    await page.evaluate(() => window.dispatchEvent(new Event('logbook-back')))
    await expect
      .poll(() => page.evaluate(() => window.__publicTableStreamFixture!.stats.cancellations))
      .toBe(1)
    expect(await page.evaluate(() => window.__publicTableStreamFixture!.state())).toEqual(before)
    await expect(page.getByRole('progressbar')).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '表格导入预览' })).toHaveCount(0)
  } finally {
    release()
  }
})
