import { acceptAppConfirmations } from './helpers'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expandModules } from './helpers'

async function setup(page: Page) {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
  await page.getByLabel('显示鼠标手势辅助').uncheck()
  await expandModules(page)
}

test('松手前同组实时让位；排序无专属安全副本，完成提示自动收起且不移动列表', async ({ page }, info) => {
  await setup(page)
  const rows = page
    .locator('.module-group')
    .filter({ hasText: '雾港调查' })
    .locator('.record-list .gesture-row')
  const firstId = await rows.first().getAttribute('data-drag-id')
  const handle = rows.first().locator('.drag-handle')
  await handle.scrollIntoViewIfNeeded()
  const a = (await handle.boundingBox())!
  const b = (await rows.nth(1).boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2, b.y + b.height / 2, { steps: 12 })
  await expect(rows.nth(1)).toHaveAttribute('data-drag-preview', 'true')
  await expect
    .poll(() =>
      rows.nth(1).evaluate((node) => parseFloat(getComputedStyle(node).transform.split(',')[5] || '0'))
    )
    .toBeLessThan(-40)
  expect(await rows.first().getAttribute('data-drag-id')).toBe(firstId)
  await page.screenshot({ path: info.outputPath('live-yield-before-release.png') })
  const y = await page.evaluate(() => scrollY)
  await page.mouse.up()
  await expect(page.getByRole('status')).toHaveText('排序已保存。')
  await expect(rows.first()).toContainText('第二场')
  await expect(page.locator('.drag-source, [data-drag-preview], .gesture-row.drag')).toHaveCount(0)
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(y, 0)
  const rowTop = (await rows.first().boundingBox())!.y
  const nav = (await page.locator('.bottom-nav').boundingBox())!
  const feedback = (await page.locator('.operation-feedback').boundingBox())!
  expect(feedback.y).toBeGreaterThan(0)
  expect(feedback.y + feedback.height).toBeLessThanOrEqual(nav.y + 1)
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 5000 })
  expect((await rows.first().boundingBox())!.y).toBeCloseTo(rowTop, 0)
  await page.getByRole('button', { name: '刷新测试文件列表', exact: true }).click()
  await expect(page.getByText('测试文件（0）', { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('records-after-sort.png') })
})

test('取消、失焦和后台信号移除让位及拖影，不保存临时顺序，随后仍能排序', async ({ page }) => {
  await setup(page)
  const rows = page
    .locator('.module-group')
    .filter({ hasText: '雾港调查' })
    .locator('.record-list .gesture-row')
  for (const signal of ['blur', 'pagehide', 'logbook-gesture-reset']) {
    await rows.first().locator('.drag-handle').scrollIntoViewIfNeeded()
    const a = (await rows.first().locator('.drag-handle').boundingBox())!
    const b = (await rows.nth(1).boundingBox())!
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + a.width / 2, b.y + b.height / 2, { steps: 8 })
    await expect(rows.nth(1)).toHaveAttribute('data-drag-preview', 'true')
    await page.evaluate((event) => window.dispatchEvent(new Event(event)), signal)
    await page.mouse.up()
    await expect(
      page.locator('.drag-source, [data-drag-preview], .gesture-row.drag, .drop-target')
    ).toHaveCount(0)
    await expect(rows.first()).toContainText('第一场')
    expect(
      await rows.evaluateAll((nodes) => nodes.every((node) => !(node as HTMLElement).style.transform))
    ).toBe(true)
  }
  await page.reload()
  await expandModules(page)
  await expect(rows.first()).toContainText('第一场')
})

test('模组排序让整个展开分组实时让位，取消后恢复，不跨模组排列场次', async ({ page }) => {
  await setup(page)
  const groups = page.locator('.module-group')
  const handle = groups.nth(1).locator(':scope > .gesture-row .drag-handle')
  await handle.scrollIntoViewIfNeeded()
  const a = (await handle.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2, 140, { steps: 10 })
  await expect(groups.first()).toHaveAttribute('data-drag-preview', 'true')
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  await page.mouse.up()
  await expect(page.locator('.drag-source, [data-drag-preview]')).toHaveCount(0)
  await expect(groups.first().locator('[data-module-toggle]')).toContainText('雾港调查')
})

test('手柄无分隔细线，多选仅保留单一卡片边界', async ({ page }, info) => {
  await setup(page)
  const row = page.locator('.record-list .gesture-row').first()
  await row.scrollIntoViewIfNeeded()
  const body = (await row.locator('.record-card').boundingBox())!
  await page.mouse.move(body.x + 45, body.y + 25)
  await page.mouse.down()
  await page.waitForTimeout(520)
  await page.mouse.up()
  await expect(page.getByLabel('选择 第一场：灯塔线索')).toBeChecked()
  expect(await row.locator('.drag-handle').evaluate((node) => getComputedStyle(node).borderLeftWidth)).toBe(
    '0px'
  )
  expect(await row.locator('.record-card').evaluate((node) => getComputedStyle(node).borderLeftWidth)).toBe(
    '0px'
  )
  expect(
    await row.locator('.gesture-content').evaluate((node) => getComputedStyle(node).borderLeftWidth)
  ).toBe('1px')
  await row.locator('.record-card').focus()
  expect(await row.locator('.record-card').evaluate((node) => getComputedStyle(node).outlineWidth)).toBe(
    '0px'
  )
  await row.locator('.drag-handle').focus()
  expect(await row.locator('.drag-handle').evaluate((node) => getComputedStyle(node).outlineWidth)).toBe(
    '0px'
  )
  await page.screenshot({ path: info.outputPath('single-boundary-selection.png') })
})
