import { expect, test } from '@playwright/test'
import { searchSample } from '../src/dev/sample'
import { acceptAppConfirmations, expandModules } from './helpers'

for (const action of [
  'select',
  'module',
  'search',
  'new-module',
  'new-record',
  'batch',
  'same-tab',
  'background',
  'system-back',
  'characters',
  'settings'
] as const) {
  test(`正文返回定位只持续到下一次操作：${action}`, async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept())
    await acceptAppConfirmations(page)
    await page.goto('/')
    await page.getByRole('button', { name: '选择并确认保存位置' }).click()
    await page.getByRole('button', { name: '数据与设置', exact: true }).click()
    const sample = searchSample()
    sample.modules = [sample.modules[0]!]
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
    await expandModules(page)
    const target = page.locator('[data-record-id="public-return-11"]')
    await target.click()
    await page.getByRole('button', { name: '返回场次', exact: true }).click()
    await expect(target).toHaveAttribute('aria-current', 'true')
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(200)
    if (action === 'select') {
      await page.getByRole('button', { name: '全选此模组', exact: true }).click()
    } else if (action === 'module') {
      await page.locator('[data-module-toggle]').click()
      await page.locator('[data-module-toggle]').click()
    } else if (action === 'search') {
      await page.getByRole('searchbox', { name: '搜索该模组所有场次正文' }).click()
    } else if (action === 'new-module' || action === 'new-record') {
      await page
        .getByRole('button', { name: action === 'new-module' ? '新增模组' : '新增手动场次', exact: true })
        .click()
      await page.getByRole('button', { name: '取消编辑', exact: true }).click()
    } else if (action === 'batch') {
      await page.getByRole('button', { name: '批量检测', exact: true }).click()
      await page
        .getByRole('dialog', { name: '批量检测', exact: true })
        .getByRole('button', { name: '取消', exact: true })
        .click()
    } else if (action === 'same-tab') {
      await page.getByRole('button', { name: '跑团记录', exact: true }).click()
    } else if (action === 'background') {
      await page.locator('.gesture-hint').click()
    } else if (action === 'system-back') {
      await page.evaluate(() => window.dispatchEvent(new Event('logbook-back')))
    } else {
      await page
        .getByRole('button', { name: action === 'characters' ? '角色卡' : '数据与设置', exact: true })
        .click()
      // 两种返回入口都应开启普通列表，不重新播放已消费的正文返回定位。
      if (action === 'characters') await page.evaluate(() => window.dispatchEvent(new Event('logbook-back')))
      else await page.getByRole('button', { name: '跑团记录', exact: true }).click()
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
    }
    await expect(page.locator('.record-card[aria-current="true"]')).toHaveCount(0)
    await expect(page.locator('.reading-return')).toHaveCount(0)
    if (action === 'select') await page.getByRole('button', { name: '退出多选', exact: true }).click()
    await target.click()
    await page.getByRole('button', { name: '返回场次', exact: true }).click()
    await expect(target).toHaveAttribute('aria-current', 'true')
  })
}
