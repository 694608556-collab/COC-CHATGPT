import { expect, test } from '@playwright/test'

test('底部栏约 60px，保持点击高度、不被上滑条遮挡，窄宽屏和深色正常', async ({ page }, info) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  const nav = page.getByRole('navigation', { name: '主导航' })
  for (const width of [280, 320, 360, 393, 412, 430, 600, 840]) {
    await page.setViewportSize({ width, height: 915 })
    await expect(nav.getByRole('button')).toHaveCount(3)
    const navBox = (await nav.boundingBox())!
    expect(navBox.height).toBeGreaterThanOrEqual(59)
    expect(navBox.height).toBeLessThanOrEqual(61)
    for (const name of ['跑团记录', '角色卡', '数据与设置']) {
      const button = nav.getByRole('button', { name, exact: true })
      await button.click()
      await expect(button).toHaveAttribute('aria-current', 'page')
      const box = (await button.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      expect(
        await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.bottom-nav button'), {
          x: box.x + box.width / 2,
          y: box.y + box.height - 1
        })
      ).toBe(true)
      const icon = (await button.locator('svg').boundingBox())!
      expect(icon.width).toBe(20)
      expect(icon.height).toBe(20)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  }
  await page.setViewportSize({ width: 393, height: 915 })
  await nav.screenshot({ path: info.outputPath('bottom-nav-compact-light.png') })
  await page.getByRole('button', { name: '深色模式', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await nav.screenshot({ path: info.outputPath('bottom-nav-compact-dark.png') })
  expect((await nav.boundingBox())!.height).toBeLessThanOrEqual(61)
})
