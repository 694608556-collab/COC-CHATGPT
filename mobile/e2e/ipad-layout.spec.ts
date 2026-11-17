import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { searchSample } from '../src/dev/sample'
import { acceptAppConfirmations, expandModules } from './helpers'

/** Open an isolated browser store with public records and the iOS layout. */
async function ready(page: Page): Promise<void> {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.evaluate((platform) => {
    document.documentElement.dataset.platform = platform
  }, process.env.COC_E2E_PLATFORM ?? 'ios')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await chooser
  ).setFiles({
    name: 'public-ipad.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(searchSample()))
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
}

/** Assert the root stays inside the current viewport after layout settles. */
async function fits(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const nav = await page.locator('.bottom-nav').boundingBox()
  if (nav) {
    const height = page.viewportSize()!.height
    expect(nav.y).toBeGreaterThanOrEqual(0)
    expect(nav.y + nav.height).toBeLessThanOrEqual(height + 1)
  }
}

test('Air 4 portrait and landscape use tablet width and keep navigation visible', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 })
  await ready(page)
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  for (const viewport of [
    { width: 820, height: 1180 },
    { width: 1180, height: 820 }
  ]) {
    await page.setViewportSize(viewport)
    await fits(page)
    await expect
      .poll(async () => (await page.locator('main').boundingBox())!.width)
      .toBeGreaterThan(viewport.width === 820 ? 780 : 1000)
    await page.screenshot({ path: test.info().outputPath(`records-${viewport.width}.png`), fullPage: true })
  }
})

test('editing survives repeated rotation with visible save controls', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 })
  await ready(page)
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: '新建七版角色' }).click()
  await page.getByLabel('姓名', { exact: true }).fill('横竖屏草稿')
  for (const viewport of [
    { width: 820, height: 1180 },
    { width: 1180, height: 820 }
  ]) {
    await page.setViewportSize(viewport)
    await expect(page.getByLabel('姓名', { exact: true })).toHaveValue('横竖屏草稿')
    await fits(page)
    const actions = page.locator('.editor-actions')
    await expect(actions).toBeVisible()
    const box = (await actions.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
  }
  await page.screenshot({ path: test.info().outputPath('editor-landscape.png'), fullPage: true })
})

test('backup preview stays usable after rotation', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 })
  await ready(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await chooser
  ).setFiles({
    name: 'public-preview.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(searchSample()))
  })
  const dialog = page.locator('.restore-dialog').last()
  for (const viewport of [
    { width: 820, height: 1180 },
    { width: 1180, height: 820 }
  ]) {
    await page.setViewportSize(viewport)
    await expect(dialog).toBeVisible()
    const box = (await dialog.boundingBox())!
    expect(box.width).toBeGreaterThan(700)
    expect(box.y).toBeGreaterThanOrEqual(20)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 20)
    await expect(dialog.getByRole('button', { name: '确认覆盖并导入' })).toBeVisible()
  }
})

test('narrow Split View and phone retain a fitting layout', async ({ page }) => {
  await ready(page)
  for (const viewport of [
    { width: 600, height: 820 },
    { width: 390, height: 844 },
    { width: 844, height: 390 }
  ]) {
    await page.setViewportSize(viewport)
    await fits(page)
    const box = (await page.locator('main').boundingBox())!
    expect(box.width).toBeLessThanOrEqual(Math.min(760, viewport.width))
  }
})

test('display size persists and remains usable in both tablet orientations', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 })
  await ready(page)
  const sizes = page.getByRole('group', { name: '显示字号' })
  const before = await page.locator('main').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))
  await sizes.getByRole('button', { name: '特大', exact: true }).click()
  expect(
    await page.locator('main').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))
  ).toBeGreaterThan(before)
  await page.setViewportSize({ width: 1180, height: 820 })
  await fits(page)
  await page.reload()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await expect(sizes.getByRole('button', { name: '特大', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
})

test('double click edits a body block, cancel discards and save survives reload', async ({ page }) => {
  await ready(page)
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await expandModules(page)
  await page.locator('[data-drag-id="demo-long"] .record-card').click()
  const original = await page.locator('.message p').first().innerText()
  await page.locator('.message').first().dblclick()
  let editor = page.getByRole('dialog', { name: '编辑正文', exact: true })
  await editor.getByLabel('说话者').fill('取消的说话者')
  await editor.getByLabel('正文内容').fill('取消的内容')
  await editor.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('.message p').first()).toHaveText(original)
  await page.locator('.message').first().dblclick()
  await editor.getByLabel('说话者').fill('新说话者')
  await editor.getByLabel('正文内容').fill('双击编辑完成\n第二行保持换行')
  await page.setViewportSize({ width: 1180, height: 820 })
  await expect(editor.getByLabel('正文内容')).toHaveValue('双击编辑完成\n第二行保持换行')
  await editor.getByRole('button', { name: '保存正文', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(page.locator('.message p').first()).toHaveText('双击编辑完成\n第二行保持换行')
  await expect(page.locator('.message header').first()).toContainText('新说话者')
  await page.reload()
  await expandModules(page)
  await page.locator('[data-drag-id="demo-long"] .record-card').click()
  await expect(page.locator('.message p').first()).toHaveText('双击编辑完成\n第二行保持换行')
  await expect(page.locator('.message header').first()).toContainText('新说话者')
})

test.describe('tablet touch', () => {
  test.use({ hasTouch: true, viewport: { width: 820, height: 1180 } })
  test('two taps open the body editor', async ({ page }) => {
    await ready(page)
    await page.getByRole('button', { name: '跑团记录', exact: true }).click()
    await expandModules(page)
    await page.locator('[data-drag-id="demo-long"] .record-card').click()
    const message = page.locator('.message').first()
    await message.scrollIntoViewIfNeeded()
    const box = (await message.boundingBox())!
    await page.touchscreen.tap(box.x + 20, box.y + 20)
    await page.touchscreen.tap(box.x + 20, box.y + 20)
    await expect(page.getByRole('dialog', { name: '编辑正文', exact: true })).toBeVisible()
  })
})

test('failed body save keeps the draft and the original stored text', async ({ page }) => {
  await ready(page)
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await expandModules(page)
  await page.locator('[data-drag-id="demo-long"] .record-card').click()
  const original = await page.locator('.message p').first().innerText()
  await page.locator('.message').first().dblclick()
  const editor = page.getByRole('dialog', { name: '编辑正文', exact: true })
  await editor.getByLabel('说话者').fill('失败时的说话者')
  await editor.getByLabel('正文内容').fill('写入失败时的草稿')
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () {
      throw new Error('公开测试写入失败')
    }
  })
  await editor.getByRole('button', { name: '保存正文', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('正文保存失败')
  await expect(editor.getByLabel('正文内容')).toHaveValue('写入失败时的草稿')
  await expect(editor.getByLabel('说话者')).toHaveValue('失败时的说话者')
  await page.reload()
  await expandModules(page)
  await page.locator('[data-drag-id="demo-long"] .record-card').click()
  await expect(page.locator('.message p').first()).toHaveText(original)
})

test('body editor actions remain inside a keyboard-sized visible viewport', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 })
  await ready(page)
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await expandModules(page)
  await page.locator('[data-drag-id="demo-long"] .record-card').click()
  await page.evaluate(() => {
    const view = Object.assign(new EventTarget(), {
      width: 820,
      height: 320,
      offsetTop: 90,
      offsetLeft: 0
    })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: view })
  })
  await page.locator('.message').first().dblclick()
  const editor = page.getByRole('dialog', { name: '编辑正文', exact: true })
  for (const name of ['取消', '保存正文']) {
    const button = editor.getByRole('button', { name, exact: true })
    await expect(button).toBeVisible()
    const box = (await button.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(90)
    expect(box.y + box.height).toBeLessThanOrEqual(410)
  }
})

test('manual speaker survives reopening with multiline body', async ({ page }) => {
  await ready(page)
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await expandModules(page)
  await page.locator('[data-drag-id="demo-manual"] .record-card').click()
  await page.locator('.message').first().dblclick()
  const editor = page.getByRole('dialog', { name: '编辑正文', exact: true })
  await editor.getByLabel('说话者').fill('手动说话者')
  await editor.getByLabel('正文内容').fill('手动完整正文\n第二段')
  await editor.getByRole('button', { name: '保存正文', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(page.locator('.message header').first()).toHaveText('手动说话者')
  await page.reload()
  await expandModules(page)
  await page.locator('[data-drag-id="demo-manual"] .record-card').click()
  await page.locator('.message').first().dblclick()
  await expect(editor.getByLabel('说话者')).toHaveValue('手动说话者')
  await expect(editor.getByLabel('正文内容')).toHaveValue('手动完整正文\n第二段')
})
