import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { searchSample } from '../src/dev/sample'
import { acceptAppConfirmations } from './helpers'

/** @param page - 独立测试页面。 @returns 导入完成后的公开样本，不在页面切换中提前开始断言。 */
async function ready(page: Page, count = 35) {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const sample = searchSample()
  sample.modules[0]!.pairs = Array.from({ length: count }, (_, i) => ({
    pc: `公开姓名${i + 1}`,
    pl: '公开玩家'
  }))
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await chooser
  ).setFiles({
    name: 'public-viewport.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
  return sample
}

test('勾选关联模组直接在姓名框下方显示候选，无需先点姓名且不自动修改草稿', async ({ page }) => {
  const sample = await ready(page, 2)
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: '新建七版角色' }).click()
  const module = page.getByRole('checkbox', { name: sample.modules[0]!.name, exact: true })
  await module.check()
  const input = page.getByLabel('姓名', { exact: true })
  const menu = page.getByRole('listbox', { name: '模组PC姓名候选', exact: true })
  await expect(menu).toBeVisible()
  await expect(input).toHaveValue('')
  await expect(input).not.toBeFocused()
  expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(
    (await input.boundingBox())!.y + (await input.boundingBox())!.height
  )
  await menu.getByRole('option', { name: '公开姓名2', exact: true }).click()
  await expect(input).toHaveValue('公开姓名2')
  await module.uncheck()
  await expect(menu).toHaveCount(0)
  await expect(input).toHaveValue('公开姓名2')
  await module.check()
  await expect(menu.getByRole('option')).toHaveCount(2)
  await expect(input).toHaveValue('公开姓名2')
})

test('模拟可见区域缩小和偏移时姓名菜单及保存栏避让，候选键盘滚动和保存重开有效', async ({ page }, info) => {
  await page.addInitScript(() => {
    const probe = Object.assign(new EventTarget(), {
      offsetTop: 0,
      offsetLeft: 0,
      width: innerWidth,
      height: innerHeight
    })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: probe })
  })
  const sample = await ready(page)
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: '新建七版角色' }).click()
  await page.getByRole('checkbox', { name: sample.modules[0]!.name, exact: true }).check()
  const input = page.getByLabel('姓名', { exact: true })
  await input.click()
  const menu = page.getByRole('listbox', { name: '模组PC姓名候选', exact: true })
  await expect(menu.getByRole('option')).toHaveCount(35)
  await page.evaluate(() => {
    const viewport = window.visualViewport!
    Object.assign(viewport, { offsetTop: 70, height: 350 })
    viewport.dispatchEvent(new Event('resize'))
    viewport.dispatchEvent(new Event('scroll'))
  })
  await expect
    .poll(
      async () =>
        (await page.locator('.editor-actions').boundingBox())!.y +
        (await page.locator('.editor-actions').boundingBox())!.height
    )
    .toBe(420)
  const toolbar = (await page.locator('.editor-actions').boundingBox())!
  await expect(menu).toBeVisible()
  await expect
    .poll(async () => (await menu.boundingBox())!.y + (await menu.boundingBox())!.height)
    .toBeLessThanOrEqual(toolbar.y)
  const menuBox = (await menu.boundingBox())!
  expect(menuBox.y).toBeGreaterThanOrEqual(78)
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(toolbar.y)
  expect(menuBox.y).toBeGreaterThanOrEqual(
    (await input.boundingBox())!.y + (await input.boundingBox())!.height
  )
  expect((await page.getByRole('button', { name: '保存修改', exact: true }).boundingBox())!.height).toBe(30)
  await input.press('ArrowDown')
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
  await expect(input).toHaveValue('')
  await expect(menu).toBeVisible()
  await input.press('Escape')
  await input.click()
  for (let i = 0; i < 35; i++) await input.press('ArrowDown')
  await expect(menu.getByRole('option', { name: '公开姓名35', exact: true })).toBeInViewport()
  const option = (await menu.getByRole('option', { name: '公开姓名35', exact: true }).boundingBox())!
  expect(option.y + option.height).toBeLessThanOrEqual(menuBox.y + menuBox.height)
  await page.screenshot({ path: info.outputPath('name-visible-viewport.png') })
  await input.press('Enter')
  await expect(input).toHaveValue('公开姓名35')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.editor')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await expect(page.getByRole('button', { name: /^公开姓名35/ })).toBeVisible()
})

test('无 VisualViewport 时回退短窗口；保存失败保留草稿且错误可见，取消仍确认，再试可保存', async ({
  page
}, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
  })
  await page.route('**/app.js', async (route) => {
    const response = await route.fetch(),
      source = await response.text()
    const pattern = /var (\w+) = createBrowserPort\(\);/
    expect(source).toMatch(pattern)
    const body = source.replace(
      pattern,
      (line, browser) => `${line}
      { let fail = true; const original = ${browser}.port.commitEntity.bind(${browser}.port);
        ${browser}.port.commitEntity = async (options) => { if (fail) { fail = false; throw new Error('公开保存失败测试'); } return original(options); }; }`
    )
    await route.fulfill({ response, body })
  })
  const sample = await ready(page)
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const headings = await page.locator('main h2').allTextContents()
  expect(headings.indexOf('显示主题')).toBe(headings.indexOf('阅读与导出默认设置') + 1)
  expect(headings.indexOf('备份与恢复')).toBe(headings.indexOf('自动本地备份') + 1)
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: '新建七版角色' }).click()
  await page.getByRole('checkbox', { name: sample.modules[0]!.name, exact: true }).check()
  await page.setViewportSize({ width: 320, height: 360 })
  await page.getByLabel('姓名', { exact: true }).click()
  await expect(page.getByRole('listbox', { name: '模组PC姓名候选', exact: true })).toBeVisible()
  const menuBox = (await page.getByRole('listbox', { name: '模组PC姓名候选', exact: true }).boundingBox())!
  const headerBox = (await page.locator('.app-header').boundingBox())!
  expect(menuBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height)
  await expect(page.locator('.operation-feedback [role="status"]')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('name-short-window.png') })
  await page.getByLabel('姓名', { exact: true }).fill('公开失败草稿')
  await page.getByLabel('调查员经历', { exact: true }).fill('公开草稿保持完整')
  await expect(page.getByRole('button', { name: '保存修改', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('公开保存失败测试')
  await expect(page.getByRole('alert')).toBeInViewport()
  await expect(page.getByLabel('姓名', { exact: true })).toHaveValue('公开失败草稿')
  await expect(page.getByRole('textbox', { name: '调查员经历', exact: true })).toHaveValue('公开草稿保持完整')
  await page.screenshot({ path: info.outputPath('editor-short-window.png') })
  const confirmation = page.getByRole('dialog', { name: '确认操作', exact: true })
  await page.removeLocatorHandler(confirmation)
  await page.getByRole('button', { name: '取消编辑', exact: true }).click()
  await expect(confirmation).toContainText('放弃尚未保存')
  await confirmation.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByLabel('姓名', { exact: true })).toHaveValue('公开失败草稿')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.editor')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await expect(page.getByRole('button', { name: /^公开失败草稿/ })).toBeVisible()
})

test('公开姓名候选触摸失焦不卸载，视口平移不反向滚动，滑动不误选', async ({ page }) => {
  await page.addInitScript(() => {
    const probe = Object.assign(new EventTarget(), {
      offsetTop: 0,
      offsetLeft: 0,
      width: innerWidth,
      height: innerHeight
    })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: probe })
  })
  const sample = await ready(page)
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: '新建七版角色' }).click()
  await page.getByRole('checkbox', { name: sample.modules[0]!.name, exact: true }).check()
  const input = page.getByLabel('姓名', { exact: true })
  await input.click()
  const menu = page.getByRole('listbox', { name: '模组PC姓名候选', exact: true })
  const first = menu.getByRole('option', { name: '公开姓名1', exact: true })
  await first.dispatchEvent('pointerdown', {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 30,
    clientY: 300,
    bubbles: true
  })
  // iOS 触摸候选时 relatedTarget 可能为空；菜单必须存活到 click。
  await input.evaluate((node) => node.blur())
  await expect(menu).toBeVisible()
  await first.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', bubbles: true })
  await first.dispatchEvent('click')
  await expect(input).toHaveValue('公开姓名1')
  await input.click()
  await menu.evaluate((node) => {
    node.scrollTop = 100
  })
  await expect(input).toHaveValue('公开姓名1')
  await expect.poll(() => menu.evaluate((node) => node.scrollTop)).toBe(100)
  // 先移出可见区，再只发 visualViewport.scroll：模拟用户主动平移。
  const scroll = await page.evaluate(() => {
    window.scrollTo(0, 600)
    return window.scrollY
  })
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { offsetTop: 150 })
    window.visualViewport!.dispatchEvent(new Event('scroll'))
  })
  await page.waitForTimeout(150)
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll)
  await page.getByLabel('职业', { exact: true }).click()
  await expect(menu).toHaveCount(0)
})

test('真实浏览器触摸：姓名列表原生滑动后可点选且键盘焦点不丢失', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true })
  const page = await context.newPage()
  try {
    const sample = await ready(page)
    await page.getByRole('button', { name: '角色卡', exact: true }).click()
    await page.getByRole('button', { name: '新建七版角色' }).click()
    await page.getByRole('checkbox', { name: sample.modules[0]!.name, exact: true }).check()
    const input = page.getByLabel('姓名', { exact: true })
    await input.tap()
    const menu = page.getByRole('listbox', { name: '模组PC姓名候选', exact: true })
    const box = (await menu.boundingBox())!
    const client = await context.newCDPSession(page)
    const x = box.x + box.width / 2,
      y = box.y + box.height - 20
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 1; i <= 8; i++) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y - i * 18 }]
      })
      await page.waitForTimeout(20)
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(() => menu.evaluate((node) => node.scrollTop)).toBeGreaterThan(30)
    await expect(input).toHaveValue('')
    await expect(input).toBeFocused()
    const name = await menu.getByRole('option').evaluateAll((nodes) => {
      const menu = nodes[0]!.parentElement!.getBoundingClientRect()
      return nodes.find((node) => {
        const r = node.getBoundingClientRect()
        return r.top >= menu.top && r.bottom <= menu.bottom
      })!.textContent!
    })
    await menu.getByRole('option', { name, exact: true }).tap()
    await expect(input).toHaveValue(name)
    await expect(input).toBeFocused()
    await expect(menu).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('WebKit 键盘平移后的矩形坐标不重复叠加 offset，两候选完整可见且可选', async ({ page }) => {
  await page.addInitScript(() => {
    const probe = Object.assign(new EventTarget(), {
      offsetTop: 0,
      offsetLeft: 0,
      width: innerWidth,
      height: innerHeight
    })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: probe })
  })
  const sample = await ready(page, 2)
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: '新建七版角色' }).click()
  await page.getByRole('checkbox', { name: sample.modules[0]!.name, exact: true }).check()
  const input = page.getByLabel('姓名', { exact: true })
  await input.click()
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { offsetTop: 203, height: 456 })
    // 模拟 WKWebView 平移文档和 fixed 合成层；BCR 已包含这 203px。
    Object.assign(document.body.style, { position: 'relative', top: '-203px', paddingTop: '300px' })
    document.documentElement.style.setProperty('--app-safe-top', '59px')
    const dock = document.querySelector('.navigation-dock') as HTMLElement
    dock.style.marginTop = '-203px'
    const field = document.querySelector('input[role="combobox"]')!
    window.scrollTo(0, scrollY + field.getBoundingClientRect().top - 276)
    window.visualViewport!.dispatchEvent(new Event('resize'))
  })
  const menu = page.getByRole('listbox', { name: '模组PC姓名候选', exact: true })
  await expect(menu).toBeVisible()
  await expect.poll(async () => (await menu.boundingBox())!.height).toBeGreaterThanOrEqual(98)
  const box = (await menu.boundingBox())!
  for (const option of await menu.getByRole('option').all()) {
    const row = (await option.boundingBox())!
    expect(row.y).toBeGreaterThanOrEqual(box.y)
    expect(row.y + row.height).toBeLessThanOrEqual(box.y + box.height)
  }
  await menu.getByRole('option', { name: '公开姓名2', exact: true }).click()
  await expect(input).toHaveValue('公开姓名2')
})

test('姓名已聚焦且候选关闭时，原生仅送达pointerdown也重新提供候选，不依赖合成click', async ({ page }) => {
  const sample = await ready(page, 2)
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: '新建七版角色' }).click()
  await page.getByRole('checkbox', { name: sample.modules[0]!.name, exact: true }).check()
  const input = page.getByLabel('姓名', { exact: true })
  const menu = page.getByRole('listbox', { name: '模组PC姓名候选', exact: true })
  await input.click()
  await menu.getByRole('option', { name: '公开姓名2', exact: true }).click()
  await expect(input).toBeFocused()
  await expect(menu).toHaveCount(0)
  // 云端实际收到这一事件后没有合成click，焦点仍在原姓名框。
  await input.dispatchEvent('pointerdown', { pointerId: 21, pointerType: 'touch', bubbles: true })
  await expect(menu).toBeVisible()
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('公开姓名2')
  await input.dispatchEvent('pointerup', { pointerId: 21, pointerType: 'touch', bubbles: true })
  await menu.getByRole('option', { name: '公开姓名1', exact: true }).click()
  await expect(input).toHaveValue('公开姓名1')
  await expect(input).toBeFocused()
})

test('原生键盘pageTop已含平移时不反向滚动，两个姓名候选均能实际命中', async ({ page }) => {
  await page.addInitScript(() => {
    const probe = Object.assign(new EventTarget(), {
      offsetTop: 0,
      offsetLeft: 0,
      width: innerWidth,
      height: innerHeight
    })
    // 原生记录：pageTop=scrollY，offsetTop也已含同一次键盘平移。
    Object.defineProperties(probe, {
      pageTop: { get: () => scrollY },
      pageLeft: { get: () => scrollX }
    })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: probe })
  })
  const sample = await ready(page, 2)
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: '新建七版角色' }).click()
  await page.getByRole('checkbox', { name: sample.modules[0]!.name, exact: true }).check()
  const input = page.getByLabel('姓名', { exact: true })
  await input.click()
  await page.evaluate(() => {
    const field = document.querySelector('input[role="combobox"]')!
    const editor = document.querySelector('.editor') as HTMLElement
    editor.style.position = 'relative'
    editor.style.top = `${463 - (scrollY + field.getBoundingClientRect().top)}px`
    window.scrollTo(0, scrollY + field.getBoundingClientRect().top - 211)
    Object.assign(window.visualViewport!, { offsetTop: scrollY, height: 456 })
    document.documentElement.style.setProperty('--app-safe-top', '59px')
    // WKWebView也平移fixed合成层；与原生记录同样让操作栏占据屏幕底部。
    const dock = document.querySelector('.navigation-dock') as HTMLElement
    dock.style.marginTop = `${-scrollY}px`
    window.visualViewport!.dispatchEvent(new Event('resize'))
  })
  const menu = page.getByRole('listbox', { name: '模组PC姓名候选', exact: true })
  await expect
    .poll(async () => {
      const box = (await page.locator('.editor-actions').boundingBox())!
      return Math.round(box.y + box.height)
    })
    .toBe(456)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      })
  )
  await expect.poll(async () => Math.round((await input.boundingBox())!.y)).toBe(211)
  await expect
    .poll(() =>
      menu.getByRole('option').evaluateAll((nodes) =>
        nodes.every((node) => {
          const box = node.getBoundingClientRect()
          return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === node
        })
      )
    )
    .toBe(true)
  await menu.getByRole('option', { name: '公开姓名2', exact: true }).click()
  await expect(input).toHaveValue('公开姓名2')
  await input.click()
  await menu.getByRole('option', { name: '公开姓名1', exact: true }).click()
  await expect(input).toHaveValue('公开姓名1')
})
