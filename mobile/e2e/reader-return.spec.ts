import { expect, test } from '@playwright/test'
import { searchSample } from '../src/dev/sample'
import { acceptAppConfirmations, expandModules } from './helpers'

test('正文返回展开原模组，将刚读场次居中高亮；按钮、系统返回和边缘手势一致', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const sample = searchSample()
  sample.records = Array.from({ length: 24 }, (_, index) => ({
    ...sample.records[1]!,
    id: `public-return-${index}`,
    name: `公开返回定位场次 ${index + 1}`,
    order: index,
    sequenceNo: index + 1
  }))
  const choose = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await choose
  ).setFiles({
    name: 'public-return.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
  await page.reload()
  for (const [index, exit] of ['button', 'system', 'gesture'].entries()) {
    await expandModules(page)
    const target = page.locator(`[data-record-id="public-return-${[11, 0, 23][index]}"]`)
    const heightBefore = await page.evaluate(() => document.documentElement.scrollHeight)
    await target.click()
    await expect(page.getByRole('button', { name: '编辑场次', exact: true })).toBeVisible()
    if (exit === 'button') await page.getByRole('button', { name: '返回场次', exact: true }).click()
    else if (exit === 'system') await page.evaluate(() => window.dispatchEvent(new Event('logbook-back')))
    else {
      const client = await page.context().newCDPSession(page)
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 2, y: 400 }] })
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 160, y: 400 }] })
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await client.detach()
    }
    await expect(target).toHaveAttribute('aria-current', 'true')
    await expect(page.locator('.record-card[aria-current="true"]')).toHaveCount(1)
    await expect
      .poll(async () =>
        target.evaluate((node) => {
          const box = node.getBoundingClientRect()
          const wanted = scrollY + box.top + box.height / 2 - innerHeight / 2
          const bounded = Math.max(0, Math.min(wanted, document.documentElement.scrollHeight - innerHeight))
          return Math.abs(scrollY - bounded)
        })
      )
      .toBeLessThan(3)
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(heightBefore)
    if (index === 0) {
      await page.getByRole('button', { name: '数据与设置', exact: true }).click()
      await page.getByRole('button', { name: '深色模式', exact: true }).click()
      await expect(page.getByRole('button', { name: '保存安卓备份', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: '跑团记录', exact: true }).click()
    }
  }
})
