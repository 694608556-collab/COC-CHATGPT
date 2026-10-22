import { expect, test } from '@playwright/test'
import { acceptAppConfirmations } from './helpers'

test('整库JSON、ZIP和自动备份按本地日期与应用名接续编号且保留首份文件', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const stem = await page.evaluate(() => {
    const now = new Date()
    return (
      String(now.getFullYear()) +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      'COC跑团记录簿'
    )
  })
  await page.getByRole('button', { name: /^保存(安卓|手机)备份$/ }).click()
  await expect(page.locator('.recent-saved')).toContainText(stem + '.json')
  await page.getByRole('button', { name: '保存含归档 ZIP 备份' }).click()
  await expect(page.locator('.recent-saved')).toContainText(stem + '1.zip')
  await page.getByRole('button', { name: '立即生成自动备份' }).click()
  await expect(page.locator('.operation-feedback .notice')).toContainText(stem + '2.json')
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await page.getByText(/测试文件（/).click()
  for (const name of [stem + '.json', stem + '1.zip', stem + '2.json'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
})
