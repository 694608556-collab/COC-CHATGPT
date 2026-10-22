import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { acceptAppConfirmations, expandModules, swipeLeft } from './helpers'

async function ready(page: Page) {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await page.getByLabel('显示鼠标手势辅助').uncheck()
}

test('恢复原控件尺寸且不覆盖正文，新增与多选工具栏切换保持原数据和选择', async ({ page }, info) => {
  await ready(page)
  await expandModules(page)
  const group = page.locator('.module-group').filter({ hasText: '雾港调查' })
  await expect(group.getByRole('button', { name: '清空模组正文搜索', exact: true })).toHaveCount(0)
  const search = group.getByRole('searchbox')
  await search.fill('公开')
  const magnifier = (await group.getByRole('button', { name: '搜索模组正文', exact: true }).boundingBox())!
  expect(magnifier.width).toBe(30)
  expect(magnifier.height).toBeGreaterThanOrEqual(30)
  await search.press('Enter')
  for (const [target, width, minHeight] of [
    [page.getByRole('button', { name: '返回上一页', exact: true }), 44, 44],
    [group.locator('.drag-handle').first(), 30, 44],
    [group.getByRole('button', { name: '清空模组正文搜索', exact: true }), 30, 30]
  ] as const) {
    const box = (await target.boundingBox())!
    expect(box.width).toBe(width)
    expect(box.height).toBeGreaterThanOrEqual(minHeight)
  }
  await group.getByRole('button', { name: '清空模组正文搜索', exact: true }).click()
  const row = group.locator('.record-list .gesture-row').first()
  const text = (await row.locator('.record-card').boundingBox())!
  const handle = (await row.locator('.drag-handle').boundingBox())!
  expect(text.x + text.width).toBeLessThanOrEqual(handle.x + 1)
  await swipeLeft(page, row)
  const remove = row.locator('.swipe-delete')
  expect((await remove.boundingBox())!.width).toBe(40)
  await remove.press('Escape')
  await expect(remove).not.toBeVisible()
  await expect(row.locator('.gesture-content')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  await expect(group.getByRole('button', { name: '批量删除', exact: true })).toHaveCount(0)
  await expect(group.getByRole('button', { name: '新增手动场次', exact: true })).toHaveClass('primary')
  await group.getByRole('button', { name: '全选此模组', exact: true }).click()
  await expect(group.getByRole('button', { name: /新增.*场次/ })).toHaveCount(0)
  await expect(group.locator('.selection-count')).toHaveText('已选 2 场')
  await expect(group.getByRole('button', { name: '批量删除', exact: true })).toBeEnabled()
  await expect(group.getByRole('button', { name: '批量导出', exact: true })).toBeEnabled()
  await page.screenshot({ path: info.outputPath('touch-selection-toolbar.png') })
  await group.getByRole('button', { name: '退出多选', exact: true }).click()
  await expect(group.getByRole('button', { name: '新增手动场次', exact: true })).toBeVisible()
  await expect(group.getByRole('button', { name: '批量删除', exact: true })).toHaveCount(0)
  await expect(group.locator('.record-list .gesture-row')).toHaveCount(2)
})

test('长导入弹窗只滚动正文，确认取消在窄屏和短视口内持续可见', async ({ page }, info) => {
  await ready(page)
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const bytes = Buffer.from(
    ['模组名,场次名', ...Array.from({ length: 120 }, (_, i) => `公开长预览,第 ${i + 1} 场`)].join('\n')
  )
  const dialog = page.getByRole('dialog', { name: '表格导入预览', exact: true })
  async function open() {
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '导入场次表格', exact: true }).click()
    await (await chooser).setFiles({ name: 'public-long.csv', mimeType: 'text/csv', buffer: bytes })
    await expect(dialog).toContainText('新增 120 项')
  }
  await open()
  for (const viewport of [
    { width: 280, height: 915 },
    { width: 412, height: 360 },
    { width: 840, height: 915 }
  ]) {
    await page.setViewportSize(viewport)
    for (const position of [0, 0.5, 1]) {
      await dialog.locator('.dialog-body').evaluate((node, fraction) => {
        node.scrollTop = node.scrollHeight * fraction
      }, position)
      const footer = (await dialog.locator('.dialog-actions').boundingBox())!
      const body = (await dialog.locator('.dialog-body').boundingBox())!
      expect(footer.y).toBeGreaterThanOrEqual(body.y + body.height)
      expect(footer.y + footer.height).toBeLessThanOrEqual(viewport.height)
      for (const button of await dialog.locator('.dialog-actions button').all()) {
        await expect(button).toBeInViewport()
        expect((await button.boundingBox())!.height).toBe(30)
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 412, height: 700 })
  await dialog.getByRole('button', { name: '显示更多场次（剩余 20 项）', exact: true }).click()
  await dialog.getByText('公开长预览 / 第 120 场', { exact: true }).scrollIntoViewIfNeeded()
  await expect(dialog.getByText('公开长预览 / 第 120 场', { exact: true })).toBeInViewport()
  await page.screenshot({ path: info.outputPath('fixed-import-actions-light.png') })
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(
    page.getByRole('region', { name: '数据统计' }).locator('strong').filter({ hasText: '场次' })
  ).toHaveText('4场次')
  await page.getByRole('button', { name: '深色模式', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存安卓备份', exact: true })).toBeEnabled()
  await open()
  await page.screenshot({ path: info.outputPath('fixed-import-actions-dark.png') })
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
})
