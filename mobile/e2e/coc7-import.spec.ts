import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { publicCoc7Bytes, publicCoc7Workbook } from '../test-fixtures/coc7'
import { searchSample } from '../src/dev/sample'
import { createEmptyCharacter, skillFinal } from '../../src/shared/coc-rules'
import { acceptAppConfirmations } from './helpers'

test('缺少HP和无效属性仍进入草稿，底部提醒与字段标红，补齐后保存重开且不覆盖旧卡', async ({ page }, info) => {
  await ready(page)
  const book = publicCoc7Workbook(),
    sheet = book.Sheets['人物卡']!
  delete sheet.E10
  sheet.U3 = { t: 's', v: '忘记填写' }
  sheet.R17 = { t: 'e', v: 7 }
  await importCard(page, publicCoc7Bytes(book))
  await expect(page.getByRole('heading', { name: '导入七版角色卡预览', exact: true })).toBeVisible()
  await expect(page.getByLabel('导入待补填提醒')).toContainText('当前生命值 HP')
  const hp = page.getByLabel('当前 HP', { exact: true }),
    str = page.getByLabel('STR', { exact: true }),
    skill = page.getByLabel('技能1数值', { exact: true })
  for (const field of [hp, str, skill]) {
    await expect(field).toHaveValue('')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
  }
  await expect(
    page.getByText('当前生命值 HP（人物卡 E10）未填写，请在此补填。', { exact: true })
  ).toBeVisible()
  await hp.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('import-missing-fields.png') })
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.editor')).toBeVisible()
  await hp.fill('0')
  await str.fill('60')
  await skill.fill('15')
  for (const field of [hp, str, skill]) await expect(field).not.toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByLabel('导入待补填提醒')).toHaveCount(0)
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.record-card')).toHaveCount(2)
  await page.reload()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.locator('.record-card').filter({ hasText: '公开职业' }).click()
  await page.getByRole('button', { name: '编辑角色卡', exact: true }).click()
  await expect(page.getByLabel('当前 HP', { exact: true })).toHaveValue('0')
})

async function ready(page: Page) {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const sample = searchSample()
  const old = createEmptyCharacter({ edition: 7, name: '公开七版调查员' })
  old.basic.residence = '旧居住地'
  old.basic.birthplace = '旧故乡'
  sample.characters.push(old)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await chooser
  ).setFiles({
    name: 'public-existing.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  return { sample, old }
}
async function importCard(page: Page, bytes = publicCoc7Bytes()) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入七版角色卡', exact: true }).click()
  await (
    await chooser
  ).setFiles({
    name: 'public-coc7.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(bytes)
  })
}
test('七版人物卡预览取消不保存；15边界、红框物品、完整经历保存重开且同名旧卡/正文不变', async ({
  page
}, info) => {
  const { sample, old } = await ready(page)
  await importCard(page)
  await expect(page.getByRole('heading', { name: '导入七版角色卡预览', exact: true })).toBeVisible()
  await expect(page.getByLabel('居住地', { exact: true })).toHaveValue('公开居住地')
  await expect(page.getByLabel('故乡', { exact: true })).toHaveValue('公开故乡')
  await expect(page.getByLabel('出生地', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('七版角色卡导入说明')).toContainText('6项技能、4项物品')
  await page.getByRole('button', { name: '取消编辑', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await expect(page.locator('.record-card')).toHaveCount(1)
  await importCard(page)
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.editor')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await expect(page.locator('.record-card')).toHaveCount(2)
  await page.locator('.record-card').filter({ hasText: '公开职业' }).click()
  expect(await page.locator('.character-basic dt').allTextContents()).toEqual([
    '姓名',
    '年龄',
    '职业',
    '性别',
    '居住地',
    '故乡'
  ])
  await expect(page.locator('.skills-display-grid .skill-row')).toHaveCount(6)
  await expect(page.locator('.skills-display-grid')).toContainText('取悦')
  await expect(page.locator('.skills-display-grid')).not.toContainText('会计')
  await expect(page.getByText('公开末行背包', { exact: true })).toBeVisible()
  await expect(page.getByText(/公开经历首段/)).toContainText('公开经历尾段')
  await page.screenshot({ path: info.outputPath('public-coc7-import.png'), fullPage: true })
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.getByRole('button', { name: '保存安卓备份', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('备份已保存')
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await page.getByText(/测试文件（/).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^[0-9]{8}COC跑团记录簿[0-9]*\.json$/ }).click()
  const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8')).snapshot
  expect(saved.modules).toEqual(sample.modules)
  expect(saved.records).toEqual(sample.records)
  expect(saved.characters.find((c: { id: string }) => c.id === old.id)).toEqual(old)
  const added = saved.characters.find((c: { id: string }) => c.id !== old.id)
  expect(added.skills.map(skillFinal)).toEqual([15, 15, 80, 75, 35, 60])
  expect(added.moduleIds).toEqual([])
  expect(JSON.stringify(added)).not.toContain('不得')
  expect(added.occupationPointOverride).toBeUndefined()
  expect(added.story).toBe('公开经历首段\n' + '公开完整经历。'.repeat(200) + '\n公开经历尾段')
})
test('不匹配模板明确失败；旧角色保留，重新选择正常文件可导入', async ({ page }) => {
  await ready(page)
  const book = publicCoc7Workbook()
  book.Sheets['人物卡']!.B3 = { t: 's', v: '不匹配的模板' }
  await importCard(page, publicCoc7Bytes(book))
  await expect(page.getByRole('alert')).toContainText('布局')
  await expect(page.locator('.editor')).toHaveCount(0)
  await expect(page.locator('.record-card')).toHaveCount(1)
  await importCard(page)
  await expect(page.getByRole('heading', { name: '导入七版角色卡预览', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消编辑', exact: true }).click()
  await expect(page.locator('.record-card')).toHaveCount(1)
})
test('导入草稿保存失败仍保留全部内容，重试成功，不使用整库覆盖', async ({ page }) => {
  await page.route('**/app.js', async (route) => {
    const response = await route.fetch(),
      source = await response.text()
    const pattern = /var (\w+) = createBrowserPort\(\);/
    expect(source).toMatch(pattern)
    await route.fulfill({
      response,
      body: source.replace(
        pattern,
        (line, browser) => `${line}
      { let fail = true; const original = ${browser}.port.commitEntity.bind(${browser}.port);
        ${browser}.port.commitEntity = async options => { if(fail){ fail=false; throw new Error('公开角色保存失败'); } return original(options); };
      }`
      )
    })
  })
  await ready(page)
  await importCard(page)
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('公开角色保存失败')
  await expect(page.getByLabel('姓名', { exact: true })).toHaveValue('公开七版调查员')
  await expect(page.getByRole('textbox', { name: '调查员经历', exact: true })).toHaveValue(
    '公开经历首段\n' + '公开完整经历。'.repeat(200) + '\n公开经历尾段'
  )
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.editor')).toHaveCount(0)
  await expect(page.locator('.record-card')).toHaveCount(2)
})
