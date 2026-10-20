import { expect, test } from '@playwright/test'
import { acceptAppConfirmations } from './helpers'

test('iOS 顶部无返回键，品牌左移且页面操作保留', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.addInitScript(() => {
    Object.assign(window, { CapacitorCustomPlatform: { name: 'ios' } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await expect(page.locator('.app-header .app-back')).toHaveCount(0)
  const gap = await page.locator('.app-brand').evaluate((brand) => {
    const header = brand.parentElement!
    return (
      brand.getBoundingClientRect().left -
      header.getBoundingClientRect().left -
      parseFloat(getComputedStyle(header).paddingLeft)
    )
  })
  expect(Math.abs(gap)).toBeLessThan(1)
  await expect(page.locator('.app-brand')).toContainText('COC 跑团记录簿')
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await expect(page.locator('.app-header .app-back')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '跑团记录', exact: true })).toBeEnabled()
})
