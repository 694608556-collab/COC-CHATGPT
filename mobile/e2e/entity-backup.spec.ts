import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { searchSample } from '../src/dev/sample'
import { createEmptyCharacter } from '../../src/shared/coc-rules'
import { acceptAppConfirmations, expandModules } from './helpers'

test('大正文：场次打开、输入、保存与角色保存保留全部正文，重开保持关联', async ({ page }, info) => {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const sample = searchSample(),
    first = sample.records[0]!
  sample.modules = [sample.modules[0]!]
  sample.characters = [
    createEmptyCharacter({ edition: 7, moduleId: sample.modules[0]!.id, name: '公开性能角色' })
  ]
  sample.records = Array.from({ length: 75 }, (_, order) => ({
    ...first,
    id: 'large-' + order,
    order,
    name: '公开大场次 ' + order,
    link: 'https://example.invalid/public-' + order,
    rawContent: {
      ...first.rawContent!,
      sourceUrl: 'https://example.invalid/public-' + order,
      messages: Array.from({ length: 100 }, (_, index) => ({
        ...first.rawContent!.messages[0]!,
        id: order + '-' + index,
        text: '公开性能正文。'.repeat(12),
        raw: { text: '完整原始字段😀。'.repeat(5) }
      }))
    }
  }))
  const choose = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await choose
  ).setFiles({
    name: 'public-entity-performance.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await expandModules(page)
  await page.locator('[data-drag-id="large-0"] .record-card').click()
  let start = await page.evaluate(() => performance.now())
  await page.getByRole('button', { name: '编辑场次', exact: true }).click()
  await expect(page.getByLabel('场次名称', { exact: true })).toBeVisible()
  const openMs = (await page.evaluate(() => performance.now())) - start
  start = await page.evaluate(() => performance.now())
  await page.getByLabel('场次名称', { exact: true }).fill('大正文改名后')
  const inputMs = (await page.evaluate(() => performance.now())) - start
  start = await page.evaluate(() => performance.now())
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.editor')).toHaveCount(0)
  await expect(page.locator('[data-drag-id="large-0"]')).toContainText('大正文改名后')
  const recordSaveMs = (await page.evaluate(() => performance.now())) - start
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.locator('.record-card').click()
  await page.getByRole('button', { name: '编辑角色卡', exact: true }).click()
  await page.getByLabel('姓名', { exact: true }).fill('公开性能新名')
  start = await page.evaluate(() => performance.now())
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.editor')).toHaveCount(0)
  const characterSaveMs = (await page.evaluate(() => performance.now())) - start
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await page.reload()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.getByRole('button', { name: '保存安卓备份', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('备份已保存')
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await page.getByText(/测试文件（/).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^coc-android-backup-.*\.json$/ }).click()
  const saved = JSON.parse((await readFile((await (await download).path())!)).toString()).snapshot
  expect(saved.records.map((row: { rawContent: unknown }) => row.rawContent)).toEqual(
    sample.records.map((row) => row.rawContent)
  )
  expect(saved.characters[0].basic.name).toBe('公开性能新名')
  const metrics = {
    environment: 'Desktop Edge, 6x CPU throttle; browser IndexedDB only',
    records: 75,
    messages: 7500,
    sourceBytes: Buffer.byteLength(JSON.stringify(sample)),
    openMs,
    inputMs,
    recordSaveMs,
    characterSaveMs
  }
  console.log(JSON.stringify(metrics))
  await info.attach('browser-measurement.json', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json'
  })
})

test('自动备份写入期间设置仍可保存；十分钟后备份新增修改，无修改不重复', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
  await page.clock.install()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.getByLabel('启用自动备份').check()
  await expect(page.getByRole('button', { name: '保存安卓备份', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    let first = true
    crypto.subtle.digest = async (...args) => {
      if (first) {
        first = false
        await new Promise<void>((resolve) => {
          ;(window as unknown as { releaseBackup: () => void }).releaseBackup = resolve
        })
      }
      return digest(...args)
    }
  })
  await page.getByRole('button', { name: '立即生成自动备份', exact: true }).click()
  await expect(page.getByRole('button', { name: '自动备份中…', exact: true })).toBeDisabled()
  await expect(page.getByLabel('隐藏时间')).toBeEnabled()
  await page.getByLabel('隐藏时间').check()
  await expect(page.getByRole('button', { name: '保存安卓备份', exact: true })).toBeEnabled()
  await page.evaluate(() => (window as unknown as { releaseBackup: () => void }).releaseBackup())
  await expect(page.getByRole('button', { name: '立即生成自动备份', exact: true })).toBeEnabled()
  await expect(page.getByLabel('隐藏时间')).toBeChecked()
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await expect(page.getByText('测试文件（1）', { exact: true })).toBeVisible()
  await page.clock.fastForward(600000)
  await expect(page.getByRole('button', { name: '立即生成自动备份', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await expect(page.getByText('测试文件（2）', { exact: true })).toBeVisible()
  await page.clock.fastForward(1200000)
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await expect(page.getByText('测试文件（2）', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await expect(page.getByLabel('隐藏时间')).toBeChecked()
})
