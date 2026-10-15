import { acceptAppConfirmations } from './helpers'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expandModules } from './helpers'

/** @param page - 独立公开样本页面。 @returns 完成首次授权并展开模组后 resolve，无返回值。 */
async function ready(page: Page) {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await page.getByLabel('显示鼠标手势辅助').uncheck()
  await expandModules(page)
}

test('底部切换和长按无黑色焦点阴影，多选整行含复选框和手柄均为紫色底块', async ({ page }, info) => {
  await ready(page)
  const nav = page.locator('.bottom-nav').getByRole('button', { name: '角色卡', exact: true })
  await page.keyboard.press('Tab')
  await nav.focus()
  expect(await nav.evaluate((node) => getComputedStyle(node).boxShadow)).toBe('none')
  expect(await nav.evaluate((node) => getComputedStyle(node).webkitTapHighlightColor)).toBe(
    'rgba(0, 0, 0, 0)'
  )
  await page.locator('.bottom-nav').getByRole('button', { name: '跑团记录', exact: true }).click()
  const row = page.locator('.record-list .gesture-row').first()
  await row.scrollIntoViewIfNeeded()
  const card = (await row.locator('.record-card').boundingBox())!
  await page.mouse.move(card.x + 45, card.y + 25)
  await page.mouse.down()
  await page.waitForTimeout(550)
  await page.mouse.up()
  await expect(row.locator('input[type=checkbox]')).toBeChecked()
  const selected = await row.evaluate((node) => {
    const soft = getComputedStyle(document.querySelector('.bottom-nav .active')!).backgroundColor
    return {
      wholeRow: getComputedStyle(node.querySelector('.gesture-content')!).backgroundColor === soft,
      noWhiteChildren: ['.selection-check', '.drag-handle', '.record-card'].every((selector) => {
        const color = getComputedStyle(node.querySelector(selector)!).backgroundColor
        return color === soft || color === 'rgba(0, 0, 0, 0)'
      }),
      shadow: getComputedStyle(node.querySelector('.record-card')!).boxShadow
    }
  })
  expect(selected).toEqual({ wholeRow: true, noWhiteChildren: true, shadow: 'none' })
  await row.screenshot({ path: info.outputPath('whole-row-selected.png') })
  await page.locator('.module-group').first().getByRole('button', { name: '退出多选', exact: true }).click()
  await page.locator('[data-module-toggle]').first().dblclick()
  const heading = page.getByRole('heading', { name: '编辑模组', exact: true })
  await page.keyboard.press('Tab')
  await heading.focus()
  expect(await heading.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none')
})

test('批量删除显示数量并确认，取消不写入，确认仅删除本模组已选场次且不增加副本', async ({ page }) => {
  await ready(page)
  const group = page.locator('.module-group').filter({ hasText: '雾港调查' })
  await expect(group.getByRole('button', { name: '批量删除', exact: true })).toHaveCount(0)
  await group.getByRole('button', { name: '全选此模组', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: '确认操作', exact: true })
  await page.removeLocatorHandler(confirmation)
  await group.getByRole('button', { name: '批量删除', exact: true }).click()
  await expect(confirmation).toContainText('已选 2 个场次')
  await expect(confirmation).not.toContainText('安全副本')
  await confirmation.getByRole('button', { name: '取消', exact: true }).click()
  await expect(group.locator('.record-list .gesture-row')).toHaveCount(2)
  await page.getByRole('button', { name: '刷新测试文件列表', exact: true }).click()
  await expect(page.getByText('测试文件（0）', { exact: true })).toBeVisible()
  await group.getByRole('button', { name: '批量删除', exact: true }).click()
  await confirmation.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('操作已保存')
  await expect(group.locator('.record-list .gesture-row')).toHaveCount(0)
  await expect(
    page.locator('.module-group').filter({ hasText: '山间旅馆' }).locator('.record-list .gesture-row')
  ).toHaveCount(2)
  await page.getByRole('button', { name: '刷新测试文件列表', exact: true }).click()
  await expect(page.getByText('测试文件（0）', { exact: true })).toBeVisible()
  await page.reload()
  await expandModules(page)
  await expect(group.locator('.record-list .gesture-row')).toHaveCount(0)
  await expect(page.locator('[data-module-toggle]')).toHaveCount(2)
})

test('所属模组与正文来源使用应用下拉，键盘和触屏点击可选择，无系统蓝色列表', async ({ page }, info) => {
  await ready(page)
  await page
    .locator('.module-group')
    .first()
    .getByRole('button', { name: '新增手动场次', exact: true })
    .click()
  const module = page.getByRole('combobox', { name: '所属模组', exact: true })
  await module.click()
  await expect(page.getByRole('listbox')).toBeVisible({ timeout: 1000 })
  await page.getByRole('option', { name: '山间旅馆（公开测试）', exact: true }).click()
  await expect(module).toContainText('山间旅馆')
  const source = page.getByRole('combobox', { name: '正文来源', exact: true })
  await source.press('ArrowDown')
  await page.getByRole('option', { name: '手动正文', exact: true }).press('End')
  await page.getByRole('option', { name: '海豹日志链接', exact: true }).press('Enter')
  await expect(page.getByLabel('海豹日志链接', { exact: true })).toBeVisible()
  await source.click()
  expect(await page.getByRole('listbox').evaluate((node) => getComputedStyle(node).borderRadius)).toBe('10px')
  await page.screenshot({ path: info.outputPath('app-dropdown.png') })
  await page.getByRole('option', { name: '海豹日志链接', exact: true }).press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '编辑场次' })).toBeVisible()
  await source.click()
  await page.evaluate(() => window.dispatchEvent(new Event('logbook-back')))
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '编辑场次' })).toBeVisible()
  await expect(page.locator('select')).toHaveCount(0)
})

test('新建场次接续当前模组最大序号，空名称保存为第 N 场', async ({ page }) => {
  await ready(page)
  const group = page.locator('.module-group').filter({ hasText: '雾港调查' })
  await group.getByRole('button', { name: '新增手动场次', exact: true }).click()
  await expect(page.getByLabel('场次序号', { exact: true })).toHaveValue('2')
  await expect(page.getByLabel('场次名称', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('场次名称', { exact: true })).toHaveAttribute(
    'placeholder',
    '留空自动命名为“第 2 场”'
  )
  await page.getByLabel('场次序号', { exact: true }).fill('7')
  await expect(page.getByLabel('场次名称', { exact: true })).toHaveAttribute(
    'placeholder',
    '留空自动命名为“第 7 场”'
  )
  await page.getByLabel('手动正文', { exact: true }).fill('公开默认取名测试正文')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('status', { name: '普通保存状态' })).toHaveText('已保存')
  await expandModules(page)
  await expect(group.locator('.record-title').filter({ hasText: '第 7 场' })).toBeVisible()
})

test('最近保存灰色 × 只关闭显示，已导出的文件与归档登记保留', async ({ page }) => {
  await ready(page)
  await page.locator('[data-drag-id="demo-manual"] .record-card').click()
  await page.getByRole('button', { name: '导出 TXT', exact: true }).click()
  await expect(page.getByText(/最近保存：/)).toBeVisible()
  await page.getByRole('button', { name: '刷新测试文件列表', exact: true }).click()
  await expect(page.getByText('测试文件（1）', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭最近保存', exact: true }).click()
  await expect(page.getByText(/最近保存：/)).toHaveCount(0)
  await page.getByRole('button', { name: '刷新测试文件列表', exact: true }).click()
  await expect(page.getByText('测试文件（1）', { exact: true })).toBeVisible()
})

test('退出确认使用应用卡片弹窗，取消和系统返回保留草稿，确认后才丢弃', async ({ page }, info) => {
  await ready(page)
  await page.removeLocatorHandler(page.getByRole('dialog', { name: '确认操作', exact: true }))
  const nativeConfirmations: string[] = []
  page.on('dialog', (dialog) => nativeConfirmations.push(dialog.message()))
  await page.locator('.module-group').first().getByRole('button', { name: '新增手动场次' }).click()
  await page.getByLabel('场次名称', { exact: true }).fill('未保存的公开草稿')
  await page.getByRole('button', { name: '取消编辑', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认操作', exact: true })
  await expect(dialog).toContainText('放弃尚未保存的修改')
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused()
  expect(await dialog.evaluate((node) => getComputedStyle(node).fontFamily)).toContain('PingFang SC')
  await page.screenshot({ path: info.outputPath('app-confirmation.png') })
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByLabel('场次名称', { exact: true })).toHaveValue('未保存的公开草稿')
  await page.getByRole('button', { name: '取消编辑', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('logbook-back')))
  await expect(dialog).toHaveCount(0)
  await expect(page.getByLabel('场次名称', { exact: true })).toHaveValue('未保存的公开草稿')
  await page.getByRole('button', { name: '取消编辑', exact: true }).click()
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByRole('heading', { name: '编辑场次', exact: true })).toHaveCount(0)
  expect(nativeConfirmations).toEqual([])
})
