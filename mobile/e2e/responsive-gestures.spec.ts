import { test, expect } from '@playwright/test'
import type { Page, Locator } from '@playwright/test'
import { expandModules, swipeLeft } from './helpers'

async function ready(page: Page) {
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.locator('[data-module-toggle]')).toHaveCount(2)
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }))
  ).toEqual({ width: page.viewportSize()!.width, content: page.viewportSize()!.width })
  const clipped = await page
    .locator(
      'main button:visible, main input:visible, main select:visible, main textarea:visible, .bottom-nav button'
    )
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const box = node.getBoundingClientRect()
          return box.left < -1 || box.right > innerWidth + 1
        })
        .map((node) => node.getAttribute('aria-label') || node.textContent)
    )
  expect(clipped).toEqual([])
}
async function drag(page: Page, from: Locator, to: Locator) {
  await to.scrollIntoViewIfNeeded()
  await from.scrollIntoViewIfNeeded()
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(550)
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 })
  await page.mouse.up()
  await expect(page.getByRole('status')).toContainText('操作已保存')
}

test('鼠标长按多选、拖动排序、左滑删除及刷新保留', async ({ page }) => {
  await ready(page)
  await expect(page.getByText('管理模组', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^(上移|下移)/ })).toHaveCount(0)
  await page.getByRole('button', { name: '模组 雾港调查（公开测试）', exact: true }).click()
  await expect(page.locator('.selection-check')).toHaveCount(0)
  const rows = page
    .locator('.module-group')
    .filter({ hasText: '雾港调查' })
    .locator('.record-list .gesture-row')
  await rows.first().scrollIntoViewIfNeeded()
  const held = (await rows.first().boundingBox())!
  await page.mouse.move(held.x + 90, held.y + 20)
  await page.mouse.down()
  await page.waitForTimeout(550)
  await page.mouse.up()
  await expect(page.locator('.selection-check input')).toHaveCount(2)
  await expect(page.getByLabel('选择 第一场：灯塔线索（240条）')).toBeChecked()
  await page.getByRole('button', { name: '退出多选', exact: true }).click()
  await drag(page, rows.first(), rows.last())
  await expect(rows.first()).toContainText('第二场')
  await page.reload()
  await expandModules(page)
  await expect(rows.first()).toContainText('第二场')
  await swipeLeft(page, rows.first())
  await rows.first().locator('.swipe-delete').click()
  await expect(rows).toHaveCount(1)
  await page.getByRole('button', { name: '模组 雾港调查（公开测试）', exact: true }).click()
  const modules = page.locator('.module-group > .gesture-row')
  await modules.first().scrollIntoViewIfNeeded()
  await drag(page, modules.first(), modules.last())
  await expect(page.locator('[data-module-toggle]').first()).not.toContainText('雾港调查')
  await page.reload()
  await expect(page.locator('[data-module-toggle]').first()).not.toContainText('雾港调查')
})

test('真实触摸事件：普通上下滚动、长按多选、左滑删除', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await ready(page)
  await expandModules(page)
  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  const rows = page.locator('.record-list .gesture-row')
  await rows.first().scrollIntoViewIfNeeded()
  const a = (await rows.first().boundingBox())!
  const x = Math.round(a.x + 95),
    y = Math.round(a.y + 25)
  const send = async (type: string, nextX: number, nextY: number) =>
    client.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: nextX, y: nextY, id: 0, radiusX: 5, radiusY: 5 }]
    })
  const before = await page.evaluate(() => scrollY)
  await send('touchStart', x, y)
  for (let i = 1; i <= 6; i++) await send('touchMove', x, y - i * 10)
  await send('touchEnd', x, y - 60)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before)
  await expect(page.locator('.selection-check')).toHaveCount(0)
  await rows.first().scrollIntoViewIfNeeded()
  const b = (await rows.first().boundingBox())!
  await send('touchStart', x, Math.round(b.y + 25))
  await page.waitForTimeout(550)
  await send('touchEnd', x, Math.round(b.y + 25))
  await expect(page.locator('.selection-check')).toHaveCount(4)
  await page.getByRole('button', { name: '退出多选' }).first().click()
  await rows.first().scrollIntoViewIfNeeded()
  const first = (await rows.first().boundingBox())!
  const second = (await rows.nth(1).boundingBox())!
  const heldX = Math.round(first.x + 80),
    heldY = Math.round(first.y + 25)
  await send('touchStart', heldX, heldY)
  await page.waitForTimeout(550)
  await send('touchMove', heldX, heldY + 15)
  await send('touchMove', heldX, Math.round(second.y + 25))
  await send('touchEnd', heldX, Math.round(second.y + 25))
  await expect(rows.first()).toContainText('第二场')
  await expect(page.locator('.selection-check')).toHaveCount(0)
  await rows.first().scrollIntoViewIfNeeded()
  const c = (await rows.first().boundingBox())!
  const sx = Math.round(c.x + c.width * 0.7),
    sy = Math.round(c.y + 25)
  await send('touchStart', sx, sy)
  for (let i = 1; i <= 6; i++) await send('touchMove', sx - i * 15, sy)
  await send('touchEnd', sx - 90, sy)
  await expect(rows.first().locator('.swipe-delete')).toBeVisible()
  await rows.first().locator('.swipe-delete').click()
  await expect(rows).toHaveCount(3)
  await client.detach()
})

for (const width of [280, 320, 360, 393, 412, 430, 600, 840]) {
  test(width + 'px：三个页面、字段、按钮与弹窗自适应', async ({ page }) => {
    await page.setViewportSize({ width, height: 915 })
    await ready(page)
    await expandModules(page)
    await noOverflow(page)
    if (width === 393)
      await page.screenshot({ path: 'test-results/responsive-records-393.png', fullPage: true })
    await page.getByRole('button', { name: '模组 雾港调查（公开测试）', exact: true }).dblclick()
    await page.getByRole('button', { name: /添加 KP$/ }).click()
    await page.getByLabel('KP1', { exact: true }).fill('公开主持人')
    await page.getByRole('button', { name: /添加参与者$/ }).click()
    await page.getByLabel('PC1', { exact: true }).fill('未关联角色')
    await page.getByLabel('PL1', { exact: true }).fill('玩家')
    const pc = (await page.getByLabel('PC1', { exact: true }).boundingBox())!
    const pl = (await page.getByLabel('PL1', { exact: true }).boundingBox())!
    expect(Math.abs(pc.y - pl.y)).toBeLessThan(2)
    await noOverflow(page)
    await page.getByRole('button', { name: '取消编辑' }).click()
    await page.getByRole('button', { name: '角色卡', exact: true }).click()
    await page.getByRole('button', { name: '新建七版角色' }).click()
    await page.getByLabel('姓名', { exact: true }).fill('宽度测试调查员')
    await page.getByLabel('职业', { exact: true }).fill('古物鉴定师')
    await page.getByLabel('年龄', { exact: true }).fill('27')
    await page.getByText('技能', { exact: true }).click()
    await page.getByLabel('技能1数值').fill('63')
    await page.getByText('武器战斗表', { exact: true }).click()
    await page.getByRole('button', { name: /添加武器$/ }).click()
    await page.getByLabel('武器1名称').fill('手杖')
    await page.getByRole('button', { name: /添加物品$/ }).click()
    await page.getByLabel('物品1', { exact: true }).fill('记事本')
    await expect(page.getByText('职业点总额覆盖（留空按公式）')).toHaveCount(0)
    await expect(page.getByText('技能点分配')).toHaveCount(0)
    await noOverflow(page)
    if (width === 360)
      await page
        .locator('.attribute-edit-grid')
        .screenshot({ path: 'test-results/responsive-attributes-360.png' })
    await page.getByRole('button', { name: '保存修改' }).click()
    await page.getByRole('button', { name: /宽度测试调查员/ }).click()
    await expect(page.getByText('7 版 · 古物鉴定师 · 27 岁', { exact: true })).toBeVisible()
    await expect(page.locator('.skills-display-grid .skill-row').first()).toContainText('63')
    const columns = await page
      .locator('.skills-display-grid')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
    expect(columns).toBeGreaterThan(1)
    await noOverflow(page)
    if (width === 393)
      await page
        .locator('.skills-display-grid')
        .screenshot({ path: 'test-results/responsive-skills-393.png' })
    await page.getByRole('button', { name: '数据与设置', exact: true }).click()
    await expect(page.getByRole('button', { name: '导入角色卡表格', exact: true })).toHaveCount(0)
    await noOverflow(page)
    if (width === 393)
      await page.screenshot({ path: 'test-results/responsive-settings-393.png', fullPage: true })
    await page.getByRole('button', { name: '载入公开测试数据' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await noOverflow(page)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '跑团记录', exact: true }).click()
    await expandModules(page)
    await page.getByRole('button', { name: /雾港调查.*第一场：灯塔线索/ }).click()
    await noOverflow(page)
    await page.getByRole('button', { name: '更多导出格式' }).click()
    await noOverflow(page)
  })
}
