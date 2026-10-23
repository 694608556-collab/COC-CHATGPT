import { expect, test } from '@playwright/test'
import { publicTableStreamCardBytes, publicTableStreamCardPath } from '../src/dev/table-stream-fixture'
import { acceptAppConfirmations } from './helpers'

test('真实Worker连续生成完整700KB角色草稿并释放独立租约，只复用计算线程', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept())
  const bytes = Buffer.from(publicTableStreamCardBytes())
  expect(bytes.length).toBeGreaterThan(680000)
  const workers: string[] = []
  page.on('worker', worker => workers.push(worker.url()))
  await page.route('**' + publicTableStreamCardPath, route => route.fulfill({
    status: 200, body: bytes, headers: { 'content-length': String(bytes.length) }
  }))
  await acceptAppConfirmations(page)
  await page.goto('/?table-stream-fixture')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  const before = await page.evaluate(async () => (await window.__publicTableStreamFixture!.state()).revision)
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: '导入七版角色卡', exact: true }).click()
    await expect(page.getByRole('heading', { name: '导入七版角色卡预览', exact: true })).toBeVisible()
    await expect(page.getByLabel('居住地', { exact: true })).toHaveValue('公开居住地')
    await expect(page.getByLabel('故乡', { exact: true })).toHaveValue('公开故乡')
    await page.getByRole('button', { name: '取消编辑', exact: true }).click()
    await expect(page.getByRole('button', { name: '导入七版角色卡', exact: true })).toBeVisible()
  }
  const after = await page.evaluate(async () => ({
    revision: (await window.__publicTableStreamFixture!.state()).revision,
    stats: window.__publicTableStreamFixture!.stats
  }))
  expect(after.revision).toBe(before)
  expect(after.stats.active).toBe(false)
  expect(after.stats.cancellations).toBe(2)
  expect(after.stats.commits).toBe(0)
  expect(workers.filter(url => url.endsWith('/table-stream-worker.js'))).toHaveLength(1)
})
