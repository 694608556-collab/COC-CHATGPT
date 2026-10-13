import { expect, test } from '@playwright/test'
import { expandModules } from './helpers'

test('边缘滑动返回保护编辑，底部上滑请求回桌面且不清除草稿', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
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
  page.removeAllListeners('dialog')
  const cancel = page.waitForEvent('dialog').then(async (dialog) => {
    expect(dialog.message()).toContain('放弃尚未保存')
    await dialog.dismiss()
  })
  await Promise.all([swipe(3, 320, 100, 0), cancel])
  await expect(page.getByLabel('场次名称', { exact: true })).toHaveValue('保留的未保存草稿')
  await swipe(206, 913, 0, -100)
  await expect(page.getByRole('status')).toContainText('请求返回手机桌面')
  await expect(page.getByLabel('场次名称', { exact: true })).toHaveValue('保留的未保存草稿')
})
