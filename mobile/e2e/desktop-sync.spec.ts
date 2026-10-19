import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { searchSample } from '../src/dev/sample'
import { acceptAppConfirmations } from './helpers'

/** 载入公开样本，不访问私人文件或网络。@param page 测试页面。@returns 样本。 */
async function ready(page: Page) {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  const sample = searchSample(),
    first = sample.records[0]!
  sample.records = [
    {
      ...first,
      id: 'sync-success',
      link: 'https://log.weizaima.com/?key=sync-success',
      rawContent: undefined,
      status: 'pending'
    },
    {
      ...first,
      id: 'sync-fail',
      moduleId: sample.modules[1]!.id,
      link: 'https://log.weizaima.com/?key=sync-fail',
      rawContent: undefined,
      status: 'pending'
    },
    { ...sample.records[1]!, moduleId: sample.modules[1]!.id, manualContent: '公开同步手动正文\n完整末段' }
  ]
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const choose = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await choose
  ).setFiles({
    name: 'public-sync.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
  return sample
}

test('模组分组、实时统计、手动跳过和完成退出，结果保存后重开', async ({ page }, info) => {
  const sample = await ready(page)
  let calls = 0
  await page.route('**/_logbook/sea?**', async (route) => {
    calls++
    const url = new URL(route.request().url()).searchParams.get('url')!
    const failed = url.includes('sync-fail')
    if (failed) await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.fulfill({
      json: {
        status: failed ? 503 : 200,
        url,
        text: JSON.stringify({ messages: [{ nickname: '公开主持人', content: '公开检测正文' }] })
      }
    })
  })
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await page.getByRole('button', { name: '批量检测', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '批量检测', exact: true })
  for (const module of sample.modules) await panel.getByLabel(module.name, { exact: false }).check()
  await panel.getByRole('button', { name: '开始检测', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('成功 1')
  await expect(panel.getByRole('status')).toContainText('失败 0')
  await expect(panel.getByRole('status')).toContainText('手动保存内容 1 场')
  await expect(panel.getByRole('button', { name: '检测完毕', exact: true })).toBeEnabled()
  await expect(panel.getByRole('status')).toContainText('失败 1')
  await panel.getByRole('button', { name: '展开' + sample.modules[1]!.name, exact: true }).click()
  await expect(panel).toContainText('手动内容，无需检测')
  expect(calls).toBe(2)
  await page.screenshot({ path: info.outputPath('batch-grouped.png') })
  await panel.getByRole('button', { name: '检测完毕', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '批量检测', exact: true }).click()
  await page.getByRole('button', { name: '单链接检测', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '批量检测' })).toContainText('雾港调查')
})

test('CSV/Excel空白模板和重复导出保留手动正文、名称不同且成功反馈', async ({ page }) => {
  const sample = await ready(page)
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  for (const label of ['保存空白模板 CSV', '保存空白模板 Excel']) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.getByRole('status')).toContainText('空白模板已保存')
  }
  for (let index = 0; index < 2; index++) {
    await page.getByRole('button', { name: '导出记录 Excel', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('记录表格已保存并回读校验')
  }
  await page.getByRole('button', { name: '刷新测试文件列表', exact: true }).click()
  await page.getByText('测试文件（4）', { exact: true }).click()
  for (const name of ['COC跑团记录导入模板.csv', 'COC跑团记录导入模板.xlsx']) {
    const wait = page.waitForEvent('download')
    await page.getByRole('button', { name, exact: true }).click()
    const bytes = await readFile((await (await wait).path())!)
    const book = XLSX.read(bytes),
      headers = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]!]!, { header: 1 })[0]!
    expect(headers.indexOf('手动保存内容')).toBe(headers.indexOf('KP1') - 1)
  }
  const table = page.getByRole('button', { name: /^COC跑团记录\d{8}\.xlsx$/ })
  const wait = page.waitForEvent('download')
  await table.click()
  const bytes = await readFile((await (await wait).path())!)
  const book = XLSX.read(bytes)
  const rows = book.SheetNames.flatMap((name) =>
    XLSX.utils.sheet_to_json<Record<string, string>>(book.Sheets[name]!)
  )
  expect(rows.find((row) => row['手动保存内容'])!['手动保存内容']).toBe(sample.records[2]!.manualContent)
})

test('检测保存失败不显示检测完毕，重试后才完成', async ({ page }) => {
  await page.route('**/app.js', async (route) => {
    const response = await route.fetch(),
      source = await response.text()
    const pattern = /var (\w+) = createBrowserPort\(\);/
    expect(source).toMatch(pattern)
    await route.fulfill({
      response,
      body: source.replace(
        pattern,
        (line, browser) => `${line}
    { let fail=true; const save=${browser}.port.commitEdit.bind(${browser}.port);
      ${browser}.port.commitEdit=async input=>{ if(fail){fail=false;throw new Error('公开检测保存失败');}return save(input); };
    }`
      )
    })
  })
  const sample = await ready(page)
  await page.route('**/_logbook/sea?**', async (route) => {
    const url = new URL(route.request().url()).searchParams.get('url')!
    await route.fulfill({
      json: {
        status: 200,
        url,
        text: JSON.stringify({ messages: [{ nickname: '公开主持人', content: '公开检测正文' }] })
      }
    })
  })
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await page.getByRole('button', { name: '批量检测', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '批量检测', exact: true })
  await panel.getByLabel(sample.modules[0]!.name, { exact: false }).check()
  await panel.getByRole('button', { name: '开始检测', exact: true }).click()
  await expect(panel).toContainText('公开检测保存失败')
  await expect(panel.getByRole('button', { name: '检测完毕', exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: '开始检测', exact: true }).click()
  await expect(panel.getByRole('button', { name: '检测完毕', exact: true })).toBeEnabled()
})
