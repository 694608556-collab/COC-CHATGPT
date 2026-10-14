import { acceptAppConfirmations } from './helpers'
import { expect, test } from '@playwright/test'
import { expandModules } from './helpers'

test('边缘滑动返回保护编辑，底部上滑请求回桌面且不清除草稿', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  /** @param x - 起始横坐标。 @param y - 起始纵坐标。 @param dx - 横向位移。 @param dy - 纵向位移。 @returns 手势完成。 */
  async function swipe(x: number, y: number, dx: number, dy: number) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] })
    for (let step = 1; step <= 8; step++)
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * step) / 8, y: y + (dy * step) / 8, id: 0 }]
      })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await swipe(409, 320, -100, 0)
  await expect(page.getByRole('heading', { name: '跑团记录汇总', exact: true })).toBeVisible()
  await expandModules(page)
  await page.locator('.record-card').first().click()
  await page.getByRole('button', { name: '编辑场次', exact: true }).click()
  await page.getByLabel('场次名称', { exact: true }).fill('保留的未保存草稿')
  const confirmation = page.getByRole('dialog', { name: '确认操作', exact: true })
  await page.removeLocatorHandler(confirmation)
  await swipe(3, 320, 100, 0)
  await expect(confirmation).toContainText('放弃尚未保存')
  await confirmation.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByLabel('场次名称', { exact: true })).toHaveValue('保留的未保存草稿')
  await swipe(206, 913, 0, -100)
  await expect(page.getByRole('status')).toContainText('请求返回手机桌面')
  await expect(page.getByLabel('场次名称', { exact: true })).toHaveValue('保留的未保存草稿')
  await expect(page.locator('[data-navigation-zone].active')).toHaveCount(0)
  expect(
    await page.locator('.app-home-zone').evaluate((node) => getComputedStyle(node, '::after').opacity)
  ).toBe('0')
})

test('边缘/底部触摸被取消或进入后台后无残留，恢复前台不意外导航', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  for (const kind of ['left', 'home']) {
    const x = kind === 'left' ? 3 : 206
    const y = kind === 'left' ? 500 : 913
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 0, radiusX: 1, radiusY: 1 }]
    })
    for (let step = 1; step <= 4; step++)
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: x + (kind === 'left' ? 10 * step : 0),
            y: y - (kind === 'home' ? 10 * step : 0),
            id: 0,
            radiusX: 1,
            radiusY: 1
          }
        ]
      })
    await expect(page.locator('[data-navigation-zone].active')).toHaveCount(1)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      delete (document as unknown as { hidden?: boolean }).hidden
      window.dispatchEvent(new Event('pageshow'))
    })
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await expect(page.locator('[data-navigation-zone].active')).toHaveCount(0)
    expect(
      await page
        .locator('[data-navigation-zone]')
        .evaluateAll((nodes) =>
          nodes.every((node) => !(node as HTMLElement).style.getPropertyValue('--gesture-y'))
        )
    ).toBe(true)
    await expect(page.getByRole('heading', { name: '数据与设置', exact: true })).toBeVisible()
  }
})
