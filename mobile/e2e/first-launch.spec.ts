import { expect, test } from '@playwright/test'

test('首次启动渐入渐出不超过两秒，修改／导入／应用内清空及重开均不重播', async ({ page }, info) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.clock.install({ time: new Date('2026-10-24T00:00:00Z') })
  // Keep asset loading and screenshots outside timer advancement; runFor below
  // still checks the original 1600ms lifetime without extending its deadline.
  await page.clock.pauseAt(new Date('2026-10-24T00:00:01Z'))
  await page.goto('/?first-launch-preview=1')
  const intro = page.getByRole('region', { name: '首次启动欢迎页' })
  await expect(intro).toBeVisible()
  await expect(intro).toContainText('跑团记录·调查员')
  await expect(intro).toContainText('记录每一次探索')
  await expect(intro).toContainText('应用制作：亦如长风万里沙')
  expect(await intro.evaluate((el) => getComputedStyle(el).animationDuration)).toBe('1.6s')
  const fontTreatment = await intro.locator('.intro-modules, .intro-slogan').evaluateAll((lines) =>
    lines.map((line) => {
      const style = getComputedStyle(line)
      return [style.fontFamily, style.fontSize, style.fontWeight, style.letterSpacing, style.color]
    })
  )
  expect(fontTreatment[1]).toEqual(fontTreatment[0])
  await expect
    .poll(() => intro.locator('img').evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
  await page.clock.runFor(500)
  // 浏览器时钟不会同步 CSS 动画时钟；仅截图暂停在全显帧，不改变实际播放／定时验收。
  await intro.evaluate((el) =>
    el.getAnimations().forEach((animation) => {
      animation.currentTime = 800
      animation.pause()
    })
  )
  await page.screenshot({ path: info.outputPath('first-launch.png') })
  await page.clock.runFor(1200)
  await expect(intro).toHaveCount(0)
  await page.clock.resume()
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.getByLabel('隐藏时间').uncheck()
  await expect(page.getByRole('button', { name: '保存安卓备份', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '清空应用数据', exact: true }).click()
  await page
    .getByRole('dialog', { name: '确认操作', exact: true })
    .getByRole('button', { name: '确认', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText('操作已保存')
  await page.reload()
  await expect(page.getByRole('heading', { name: '跑团记录汇总', exact: true })).toBeVisible()
  await expect(intro).toHaveCount(0)
})

test('首次欢迎页中关闭页面后，同一安装存储再次打开不重播', async ({ page, context }) => {
  await page.goto('/?first-launch-preview=1')
  await expect(page.getByRole('region', { name: '首次启动欢迎页' })).toBeVisible()
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto('/?first-launch-preview=1')
  await expect(reopened.getByRole('button', { name: '选择并确认保存位置' })).toBeVisible()
  await expect(reopened.getByRole('region', { name: '首次启动欢迎页' })).toHaveCount(0)
})

test('欢迎页期间离开前台就结束展示，恢复前台不残留动画', async ({ page }) => {
  await page.goto('/?first-launch-preview=1')
  const intro = page.getByRole('region', { name: '首次启动欢迎页' })
  await expect(intro).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(intro).toHaveCount(0)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(intro).toHaveCount(0)
})
