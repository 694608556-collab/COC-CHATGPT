import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { searchSample } from '../src/dev/sample'
import { acceptAppConfirmations } from './helpers'

/** @param page - 独立测试页面。 @returns 导入完成后的公开样本，不在页面切换中提前开始断言。 */
async function ready(page: Page) {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const sample = searchSample()
  sample.modules[0]!.pairs = Array.from({ length: 35 }, (_, i) => ({
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
  const menuBox = (await menu.boundingBox())!
  expect(menuBox.y).toBeGreaterThanOrEqual(78)
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(toolbar.y)
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual((await input.boundingBox())!.y)
  expect((await page.getByRole('button', { name: '保存修改', exact: true }).boundingBox())!.height).toBe(34)
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
