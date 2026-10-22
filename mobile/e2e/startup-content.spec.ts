import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { searchSample } from '../src/dev/sample'
import { createEmptyCharacter } from '../../src/shared/coc-rules'
import { acceptAppConfirmations, expandModules } from './helpers'

type Probe = {
  requests: string[][]
  overviewBytes: number[]
  fail: string
  /** 测试边界暂停读取的继续回调；可选无参数函数，无返回值，不修改存储。 */
  release?: () => void
}
/** @param page - 隔离公开样本页面。 @returns 安装存储接口的失败／暂停探针后 resolve，无返回值。 */
async function instrument(page: Page) {
  await page.route('**/app.js', async (route) => {
    const response = await route.fetch(),
      source = await response.text()
    const declaration = /var (\w+) = createBrowserPort\(\);/
    expect(source).toMatch(declaration)
    await route.fulfill({
      response,
      body: source.replace(
        declaration,
        (line, browser) => `${line}
      {
        const probe = window.__startupProbe = { requests: [], overviewBytes: [], fail: '' };
        const port = ${browser}.port;
        const overview = port.getOverview.bind(port), content = port.getRecordContent.bind(port);
        port.getState = async () => { throw new Error('测试禁止全量启动读取'); };
        port.getOverview = async () => { const value = await overview(); probe.overviewBytes.push(new TextEncoder().encode(value.json || '').length); return value; };
        port.getRecordContent = async (input) => {
          probe.requests.push(input.ids);
          const mode = probe.fail; probe.fail = '';
          if (mode === 'hold') await new Promise(resolve => { probe.release = resolve; });
          if (mode === 'error') throw new Error('公开正文读取失败');
          const value = await content(input);
          if (mode === 'stale') return { ...value, revision: value.revision + 1 };
          if (mode === 'partial') { const data = JSON.parse(value.json); data.records.pop(); return { ...value, json: JSON.stringify(data) }; }
          return value;
        };
      }`
      )
    })
  })
}
async function probe(page: Page) {
  return page.evaluate(() => (window as unknown as { __startupProbe: Probe }).__startupProbe)
}
async function seed(page: Page, sample = searchSample()) {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await instrument(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const choose = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await choose
  ).setFiles({
    name: 'public-startup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
  await page.reload()
  await expect(page.getByRole('heading', { name: '跑团记录汇总', exact: true })).toBeVisible()
  return sample
}

test('记录表格冷启动只加载手动正文，失败不发布、重试完整保留', async ({ page }) => {
  const sample = await seed(page)
  const manualIds = sample.records
    .filter((record) => record.sourceType === 'manual')
    .map((record) => record.id)
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.evaluate(() => {
    ;(window as unknown as { __startupProbe: Probe }).__startupProbe.fail = 'error'
  })
  await page.getByRole('button', { name: '导出记录 CSV', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('公开正文读取失败')
  expect((await probe(page)).requests).toEqual([manualIds])
  for (const format of ['CSV', 'Excel']) {
    await page.getByRole('button', { name: `导出记录 ${format}`, exact: true }).click()
    await expect(page.getByRole('status')).toContainText('记录表格已保存并回读校验')
  }
  expect((await probe(page)).requests).toEqual([manualIds, manualIds])
})

test('75 场重开不读取正文，设置及角色编辑可用，阅读只取所选一场并复用', async ({ page }, info) => {
  const sample = searchSample(),
    first = sample.records[0]!
  sample.records = Array.from({ length: 75 }, (_, index) => ({
    ...first,
    id: `startup-${index}`,
    name: `公开启动第${index + 1}场`,
    order: index,
    rawContent: {
      ...first.rawContent!,
      messages: first.rawContent!.messages.slice(0, 100).map((message, i) => ({
        ...message,
        text: `公开完整正文 ${index}/${i} ` + '正文不丢失。'.repeat(35)
      }))
    }
  }))
  sample.characters = [createEmptyCharacter({ edition: 7, name: '公开启动角色' })]
  await seed(page, sample)
  await expandModules(page)
  await expect(page.locator('.record-card')).toHaveCount(75)
  expect((await probe(page)).requests).toEqual([])
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await expect(page.getByRole('region', { name: '数据统计' })).toContainText('75')
  await page.getByLabel('隐藏时间').check()
  await expect(page.getByRole('button', { name: '保存安卓备份', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: /^公开启动角色/ }).click()
  await page.getByRole('button', { name: '编辑角色卡' }).click()
  await page.getByLabel('姓名', { exact: true }).fill('公开启动角色已改')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.editor')).toHaveCount(0)
  expect((await probe(page)).requests).toEqual([])
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await expandModules(page)
  await page.locator('[data-drag-id="startup-74"] .record-card').click()
  await expect(page.getByRole('heading', { name: '公开启动第75场', exact: true })).toBeVisible()
  await expect(page.getByText(/公开完整正文 74\/0 /)).toBeVisible()
  expect((await probe(page)).requests).toEqual([['startup-74']])
  await page.getByRole('button', { name: '返回上一页', exact: true }).click()
  await expandModules(page)
  await page.locator('[data-drag-id="startup-74"] .record-card').click()
  await expect(page.getByRole('heading', { name: '公开启动第75场', exact: true })).toBeVisible()
  expect((await probe(page)).requests).toHaveLength(1)
  const metrics = {
    environment: 'Desktop Edge / browser boundary only, not Android timing',
    records: 75,
    messages: 7500,
    fullJsonBytes: Buffer.byteLength(JSON.stringify(sample)),
    overviewBytes: (await probe(page)).overviewBytes[0]
  }
  console.log(JSON.stringify(metrics))
  await info.attach('startup-payload.json', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json'
  })
})

test('打开正文读取期间不弹底部进度，失败仍提醒，重试能读完整正文', async ({ page }) => {
  await seed(page)
  await expandModules(page)
  await page.evaluate(() => {
    ;(window as unknown as { __startupProbe: Probe }).__startupProbe.fail = 'hold'
  })
  const row = page.getByRole('button', { name: /雾港调查.*第一场：灯塔线索/ })
  await row.click()
  await expect.poll(async () => (await probe(page)).requests.length).toBe(1)
  expect(await page.locator('.operation-feedback [role="progressbar"]').count()).toBe(0)
  expect(await page.getByText('正在读取已保存正文…', { exact: true }).count()).toBe(0)
  await page.evaluate(() => {
    ;(window as unknown as { __startupProbe: Probe }).__startupProbe.release?.()
  })
  await expect(page.locator('.messages .message')).toHaveCount(100)
  await expect(page.getByLabel('普通保存状态')).toHaveCount(0)
  await page.reload()
  await expandModules(page)
  await page.evaluate(() => {
    ;(window as unknown as { __startupProbe: Probe }).__startupProbe.fail = 'error'
  })
  await row.click()
  await expect(page.getByRole('alert')).toContainText('公开正文读取失败')
  await row.click()
  await expect(page.locator('.messages .message')).toHaveCount(100)
})

test('缺失、陈旧和失败的正文都不冒充无结果，重试后搜索完整且不串模组', async ({ page }) => {
  await seed(page)
  await expandModules(page)
  const first = page.locator('.module-group').filter({ hasText: '雾港调查' })
  for (const mode of ['partial', 'stale', 'error']) {
    await page.evaluate((mode) => {
      ;(window as unknown as { __startupProbe: Probe }).__startupProbe.fail = mode
    }, mode)
    if (mode === 'partial') {
      await first.getByRole('searchbox').fill('铜钥匙')
      await first.getByRole('searchbox').press('Enter')
    } else await first.getByRole('button', { name: '重试正文搜索' }).click()
    await expect(first.getByRole('button', { name: '重试正文搜索' })).toBeVisible()
    await expect(first.getByText('没有找到匹配正文', { exact: false })).toHaveCount(0)
    await expect(first.getByText('正文已保存', { exact: true })).toHaveCount(2)
  }
  await first.getByRole('button', { name: '重试正文搜索' }).click()
  await expect(first.getByText('匹配 2 个场次', { exact: false })).toBeVisible()
  for (const ids of (await probe(page)).requests)
    expect(ids.slice().sort()).toEqual(['demo-long', 'demo-manual'])
  await first.getByRole('button', { name: /第二场：手动调查笔记 ·/ }).click()
  await expect(page.getByRole('heading', { name: '第二场：手动调查笔记', exact: true })).toBeVisible()
  expect((await probe(page)).requests).toHaveLength(4)
})

test('重开后从未阅读也能备份全部正文，表格追加不会丢失未打开的场次内容', async ({ page }) => {
  const sample = await seed(page)
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const choose = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入场次表格' }).click()
  await (
    await choose
  ).setFiles({
    name: 'public-startup.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('\uFEFF模组,场次\n公开追加模组,公开追加场次\n')
  })
  const preview = page.getByRole('dialog', { name: '表格导入预览' })
  await expect(preview).toBeVisible()
  expect((await probe(page)).requests).toEqual([])
  await preview.getByRole('button', { name: '取消', exact: true }).click()
  expect((await probe(page)).requests).toEqual([])
  const retry = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入场次表格' }).click()
  await (
    await retry
  ).setFiles({
    name: 'public-startup.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('\uFEFF模组,场次\n公开追加模组,公开追加场次\n')
  })
  await page.getByRole('button', { name: '确认添加表格数据' }).click()
  await expect(page.getByRole('status')).toContainText('表格数据已添加')
  expect((await probe(page)).requests).toEqual([])
  await page.reload()
  expect((await probe(page)).requests).toEqual([])
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.getByRole('button', { name: '保存安卓备份', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('备份已保存')
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await page.getByText(/测试文件（/).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^coc-android-backup-.*\.json$/ }).click()
  const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8')).snapshot
  for (const before of sample.records) {
    const after = saved.records.find((record: { id: string }) => record.id === before.id)
    expect(after.rawContent).toEqual(before.rawContent)
    expect(after.manualContent).toBe(before.manualContent)
  }
  expect(saved.records).toHaveLength(sample.records.length + 1)
})
