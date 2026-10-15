import { expect, test } from '@playwright/test'
import { acceptAppConfirmations } from './helpers'

type SaveProbe = {
  requests: { settings: { theme: string; filterPreset: Record<string, boolean> }; expectedRevision: number }[]
  releases: ((fail: boolean) => void)[]
}

test('慢写可连续勾选并合并最新选择，失败回退到最后成功设置，重试后重开保留', async ({ page }) => {
  // 只在独立测试页面包装真实浏览器端口；生产及用户预览不加入延迟或调试入口。
  await page.route('**/app.js', async (route) => {
    const response = await route.fetch()
    const source = await response.text()
    const declaration = /var (\w+) = createBrowserPort\(\);/
    expect(source).toMatch(declaration)
    const body = source.replace(
      declaration,
      (line, port) => `${line}
      {
        const probe = window.__settingsProbe = { requests: [], releases: [] };
        const original = ${port}.port.commitSettings.bind(${port}.port);
        ${port}.port.commitSettings = async (input) => {
          probe.requests.push(input);
          await new Promise((resolve, reject) => probe.releases.push((fail) => fail ? reject(new Error('公开测试写入失败')) : resolve()));
          return original(input);
        };
      }`
    )
    await route.fulfill({ response, body })
  })
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const section = page
    .locator('.panel')
    .filter({ has: page.getByRole('heading', { name: '阅读与导出默认设置' }) })
  const height = (await section.boundingBox())!.height
  await page.getByLabel('隐藏骰指令').check()
  await expect(page.getByLabel('隐藏时间')).toBeEnabled()
  await expect(page.getByRole('button', { name: '保存安卓备份', exact: true })).toBeDisabled()
  await expect(page.getByRole('status', { name: '设置保存状态' })).toHaveText('保存中…')
  expect((await section.boundingBox())!.height).toBe(height)
  await page.getByLabel('隐藏图片链接').check()
  await page.getByLabel('隐藏时间').check()
  await page.getByRole('button', { name: '深色模式', exact: true }).click()
  await page.getByLabel('隐藏骰指令').uncheck()
  await page.getByLabel('隐藏骰指令').check()
  expect(
    await page.evaluate(
      () => (window as unknown as { __settingsProbe: SaveProbe }).__settingsProbe.requests.length
    )
  ).toBe(1)
  await page.evaluate(() =>
    (window as unknown as { __settingsProbe: SaveProbe }).__settingsProbe.releases.shift()!(false)
  )
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __settingsProbe: SaveProbe }).__settingsProbe.requests.length
      )
    )
    .toBe(2)
  const requests = await page.evaluate(
    () => (window as unknown as { __settingsProbe: SaveProbe }).__settingsProbe.requests
  )
  expect(requests[1]!.expectedRevision).toBe(requests[0]!.expectedRevision + 1)
  expect(requests[1]!.settings).toMatchObject({
    theme: 'dark',
    filterPreset: { hideDiceCommands: true, hideImages: true, hideTime: true }
  })
  await page.evaluate(() =>
    (window as unknown as { __settingsProbe: SaveProbe }).__settingsProbe.releases.shift()!(true)
  )
  await expect(page.getByRole('alert')).toContainText('公开测试写入失败')
  await expect(page.getByLabel('隐藏骰指令')).toBeChecked()
  await expect(page.getByLabel('隐藏图片链接')).not.toBeChecked()
  await expect(page.getByLabel('隐藏时间')).not.toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: '重试保存设置', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __settingsProbe: SaveProbe }).__settingsProbe.requests.length
      )
    )
    .toBe(3)
  await page.evaluate(() =>
    (window as unknown as { __settingsProbe: SaveProbe }).__settingsProbe.releases.shift()!(false)
  )
  await expect(page.getByRole('button', { name: '保存安卓备份', exact: true })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await expect(page.getByLabel('隐藏骰指令')).toBeChecked()
  await expect(page.getByLabel('隐藏图片链接')).toBeChecked()
  await expect(page.getByLabel('隐藏时间')).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('设置组件间隙统一缩窄，浅深色与窄屏不横向溢出', async ({ page }, info) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  for (const width of [280, 412, 840]) {
    await page.setViewportSize({ width, height: 915 })
    const gaps = await page
      .locator('main .summary, main > .panel')
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).marginBottom))
    expect(gaps.length).toBeGreaterThan(1)
    expect(gaps.every((gap) => gap === '8px')).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 412, height: 915 })
  await page.getByRole('button', { name: '浅色模式', exact: true }).click()
  await page.locator('.summary').evaluate((node) => node.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: info.outputPath('compact-settings-light.png') })
  await page.getByRole('button', { name: '深色模式', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存安卓备份', exact: true })).toBeEnabled()
  await page.locator('.summary').evaluate((node) => node.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: info.outputPath('compact-settings-dark.png') })
})
