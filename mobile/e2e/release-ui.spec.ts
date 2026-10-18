import { expect, test } from '@playwright/test'

test('正式界面显示 1.0.4，无开发提示，页尾版本说明和数据风险提醒保留', async ({ page }, info) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  const app = page.locator('.mobile-shell')
  await expect(app.locator('.app-header')).not.toContainText('本机数据')
  const brand = app.locator('.app-brand')
  const logo = (await brand.locator('img').boundingBox())!
  const title = (await brand.locator('strong').boundingBox())!
  const back = (await app.locator('.app-back').boundingBox())!
  expect(logo.x - back.x - back.width).toBeGreaterThanOrEqual(0)
  expect(logo.x - back.x - back.width).toBeLessThanOrEqual(16)
  expect(Math.abs(logo.y + logo.height / 2 - title.y - title.height / 2)).toBeLessThan(1)
  await expect(app.locator('.app-header .version')).toHaveText('1.0.4')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  for (const tab of ['跑团记录', '角色卡', '数据与设置']) {
    await app.getByRole('button', { name: tab, exact: true }).click()
    await expect(app.getByText(/安卓开发版|启动试验|仅保留你确认的三个模块|开发阶段说明/)).toHaveCount(0)
  }
  const version = app.getByRole('region', { name: '版本说明', exact: true })
  await expect(version).toContainText('1.0.4')
  await expect(version).toContainText('应用制作：亦如长风万里沙')
  await expect(version).not.toContainText('记录每一次探索')
  expect(await version.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px')
  expect(await version.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  expect(await version.evaluate((el) => getComputedStyle(el).textAlign)).toBe('left')
  for (const width of [320, 412]) {
    await page.setViewportSize({ width, height: 915 })
    await version.scrollIntoViewIfNeeded()
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    const footer = (await version.boundingBox())!,
      nav = (await page.locator('.bottom-nav').boundingBox())!
    expect(nav.y - footer.y - footer.height).toBeGreaterThanOrEqual(6)
    expect(nav.y - footer.y - footer.height).toBeLessThanOrEqual(24)
    const panelHeading = (await app.getByRole('heading', { name: '归档文件', exact: true }).boundingBox())!
    for (const field of await version.locator('p').all()) {
      const text = (await field.boundingBox())!
      expect(Math.abs(text.x - panelHeading.x)).toBeLessThan(1)
    }
  }
  await expect(app.getByText('不会生成操作前副本，需要时请先手动备份。', { exact: false })).toBeVisible()
  await expect(app.locator('.operation-feedback [role="status"]')).toHaveCount(0)
  await version.screenshot({ path: info.outputPath('settings-version.png') })
  await app.locator('.app-header').screenshot({ path: info.outputPath('header.png') })
})
