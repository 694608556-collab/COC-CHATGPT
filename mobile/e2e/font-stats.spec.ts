import { acceptAppConfirmations } from './helpers'
import { expect, test } from '@playwright/test'
test('四项统计、删除的设置项及离线内置桌面字体', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  const remoteFonts: string[] = []
  page.on('request', (request) => {
    if (/\.(ttf|otf)/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4173/'))
      remoteFonts.push(request.url())
  })
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await expect(page.getByRole('region', { name: '数据统计' })).toContainText('角色卡')
  await expect(page.getByRole('checkbox', { name: '首行缩进', exact: true })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: '深色导出样式', exact: true })).toHaveCount(0)
  const font = await page.evaluate(() => ({
    family: getComputedStyle(document.documentElement).fontFamily,
    loaded: Array.from(document.fonts)
      .filter((face) => face.status === 'loaded')
      .map((face) => face.family)
  }))
  expect(font.family).toContain('SF Pro Text')
  expect(font.family).toContain('PingFang SC')
  expect(font.family).not.toContain('system-ui')
  expect(font.loaded.filter((f) => f.includes('PingFang'))).toHaveLength(3)
  expect(font.loaded).toHaveLength(8)
  expect(remoteFonts).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page
    .getByRole('region', { name: '数据统计' })
    .evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const stats = page.getByRole('region', { name: '数据统计' })
  expect(
    await stats
      .locator('strong')
      .last()
      .evaluate((el) => el.getBoundingClientRect().bottom < innerHeight - 80)
  ).toBe(true)
  await page
    .getByRole('region', { name: '数据统计' })
    .screenshot({ path: 'test-results/stats-fonts-320.png' })
})
