import { expect, test } from '@playwright/test'

test('iOS 主题同步系统控件外观且保留原字号与控件尺寸', async ({ page }) => {
  await page.goto('/')
  const root = page.locator('html')
  const button = page.getByRole('button', { name: '选择并确认保存位置' })
  await expect(button).toBeVisible()
  const original = await button.boundingBox()
  const fontSize = await button.evaluate((el) => getComputedStyle(el).fontSize)
  await root.evaluate((el) => {
    el.setAttribute('data-platform', 'ios')
    el.setAttribute('data-theme', 'dark')
  })
  expect(await root.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark')
  expect(await button.evaluate((el) => getComputedStyle(el).fontSize)).toBe(fontSize)
  const ios = await button.boundingBox()
  expect(ios?.width).toBe(original?.width)
  expect(ios?.height).toBe(original?.height)
  expect(await page.locator('.app-header').evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe('rgba(0, 0, 0, 0)')
  await root.evaluate((el) => el.setAttribute('data-theme', 'light'))
  expect(await root.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('light')
})
