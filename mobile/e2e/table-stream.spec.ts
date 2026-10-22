import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { acceptAppConfirmations } from './helpers'
// Keep the routed public bytes independent from the browser fixture's bundled
// import oracle so this test exercises the actual Worker-generated candidate.
const publicTableStreamPath = '/_capacitor_file_/public-table-stream.csv'
function publicTableStreamCSV(count: number) {
  return [
    '模组名,场次名,海豹链接,手动保存内容,KP1,PC1,PL1',
    ...Array.from({ length: count }, (_, index) =>
      [
        '公开流式团',
        `公开完整场次${index}`,
        '',
        `公开完整正文 ${index}\n保留逗号,引号"和😀末尾`,
        '公开KP',
        '公开PC',
        '公开PL'
      ]
        .map((value) => '"' + value.replace(/"/g, '""') + '"')
        .join(',')
    )
  ].join('\r\n')
}

// Real table-stream Worker + MobileApp + IndexedDB. Native SQLite/phone resource
// behavior is covered separately by native checks, never inferred from this test.
async function start(page: Page) {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.route('**' + publicTableStreamPath + '**', async (route) => {
    const rows = Number(new URL(route.request().url()).searchParams.get('rows'))
    const body = Buffer.from(publicTableStreamCSV(rows))
    await route.fulfill({
      status: 200,
      contentType: 'text/csv; charset=utf-8',
      headers: { 'content-length': String(body.length) },
      body
    })
  })
  await page.goto('/?table-stream-fixture')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
}
async function evidence(page: Page) {
  return page.evaluate(async () => {
    const fixture = window.__publicTableStreamFixture!
    const state = await fixture.state()
    return {
      stats: fixture.stats,
      revision: state.revision,
      snapshot: state.json ? JSON.parse(state.json) : null
    }
  })
}
test('真实Worker流式预览分100项、取消无写入、确认一次CAS并重开保留完整正文', async ({ page }, info) => {
  const workers: string[] = []
  page.on('worker', (worker) => workers.push(worker.url()))
  await start(page)
  const before = await evidence(page)
  await page.getByRole('button', { name: '导入场次表格', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '表格导入预览' })
  await expect(dialog).toContainText('新增 205 项，更新 0 项，跳过 0 项。')
  await expect(dialog).toContainText('第 1–100 项，共 205 项')
  expect(workers.some((url) => url.endsWith('/table-stream-worker.js'))).toBe(true)
  expect((await evidence(page)).revision).toBe(before.revision)
  expect((await evidence(page)).stats.commits).toBe(0)
  await dialog.getByRole('button', { name: '下一页项目', exact: true }).click()
  await expect(dialog).toContainText('第 101–200 项，共 205 项')
  await expect(dialog.getByText('公开流式团 / 公开完整场次0', { exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: '下一页项目', exact: true }).click()
  await expect(dialog).toContainText('第 201–205 项，共 205 项')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const cancelled = await evidence(page)
  expect(cancelled.revision).toBe(before.revision)
  expect(cancelled.snapshot).toEqual(before.snapshot)
  expect(cancelled.stats.active).toBe(false)
  expect(cancelled.stats.cancellations).toBe(1)
  expect(cancelled.stats.pages).toEqual([100, 200])
  await page.getByRole('button', { name: '导入场次表格', exact: true }).click()
  await expect(dialog).toContainText('新增 205 项')
  await expect(dialog).toContainText('第 1–100 项，共 205 项')
  await dialog.getByRole('button', { name: '确认添加表格数据', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => (await evidence(page)).stats.commits).toBe(1)
  const saved = await evidence(page)
  expect(saved.revision).toBe(before.revision + 1)
  expect(saved.snapshot.records).toHaveLength(205)
  expect(saved.snapshot.records[204].manualContent).toBe('公开完整正文 204\n保留逗号,引号"和😀末尾')
  expect(saved.stats.active).toBe(false)
  await page.reload()
  const reopened = await evidence(page)
  expect(reopened.revision).toBe(saved.revision)
  expect(reopened.snapshot).toEqual(saved.snapshot)
  await info.attach('public-table-stream-browser.json', {
    body: JSON.stringify({
      environment: 'Edge real Worker + IndexedDB fixture; not native SQLite',
      workers,
      stats: saved.stats,
      revision: saved.revision,
      records: saved.snapshot.records.length
    }),
    contentType: 'application/json'
  })
})

test('确认表格提交时只显示预览内进度，后台不重复显示第二处进度', async ({ page }) => {
  await start(page)
  await page.evaluate(() => {
    window.__publicTableStreamFixture!.options.commitDelayMs = 1500
  })
  await page.getByRole('button', { name: '导入场次表格', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '表格导入预览' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '确认添加表格数据', exact: true }).click()
  await expect(dialog.getByRole('progressbar')).toHaveCount(1)
  expect(await page.getByRole('progressbar').count()).toBe(1)
  await expect(dialog).toHaveCount(0)
  expect((await evidence(page)).stats.commits).toBe(1)
})

for (const mode of ['badSourceHash', 'badCandidateHash'] as const) {
  test(`真实Worker ${mode} 失败清理且无生产写入`, async ({ page }) => {
    await start(page)
    const before = await evidence(page)
    await page.evaluate((mode) => {
      window.__publicTableStreamFixture!.options[mode] = true
    }, mode)
    await page.getByRole('button', { name: '导入场次表格', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '表格导入预览' })).toHaveCount(0)
    await expect.poll(async () => (await evidence(page)).stats.cancellations).toBe(1)
    await expect(page.getByText(/摘要.*(?:不符|变化)/).first()).toBeVisible()
    const after = await evidence(page)
    expect(after.stats.active).toBe(false)
    expect(after.stats.commits).toBe(0)
    expect(after.revision).toBe(before.revision)
    expect(after.snapshot).toEqual(before.snapshot)
  })
}

test('真实Worker读取过程中取消会释放租约且不创建预览或写入', async ({ page }) => {
  await start(page)
  const before = await evidence(page)
  let arrived!: () => void, release!: () => void
  const requested = new Promise<void>((resolve) => {
    arrived = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**' + publicTableStreamPath + '**', async (route) => {
    arrived()
    await gate
    await route.abort().catch(() => {})
  })
  try {
    await page.getByRole('button', { name: '导入场次表格', exact: true }).click()
    await requested
    await page.getByRole('button', { name: '返回上一页', exact: true }).click()
    await expect.poll(async () => (await evidence(page)).stats.cancellations).toBe(1)
    await expect(page.getByRole('dialog', { name: '表格导入预览' })).toHaveCount(0)
    const after = await evidence(page)
    expect(after.stats.active).toBe(false)
    expect(after.stats.commits).toBe(0)
    expect(after.stats.previews).toBe(0)
    expect(after.revision).toBe(before.revision)
    expect(after.snapshot).toEqual(before.snapshot)
  } finally {
    release()
  }
})
