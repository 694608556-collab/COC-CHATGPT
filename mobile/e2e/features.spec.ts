import { acceptAppConfirmations } from './helpers'
import { expandModules, swipeLeft } from './helpers'
import { test, expect } from '@playwright/test'
import { zlibSync } from 'fflate'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'

async function ready(page: import('@playwright/test').Page) {
  page.on('dialog', (dialog) => dialog.accept())
  await acceptAppConfirmations(page)
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '载入公开测试数据' }).click()
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
}
test('设置统计、导航 SVG、完整角色编辑、关联及删除清理', async ({ page }) => {
  await ready(page)
  await expect(page.getByRole('region', { name: '数据统计' })).toHaveCount(0)
  await expect(page.locator('.bottom-nav svg')).toHaveCount(3)
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await expect(page.getByRole('region', { name: '数据统计' })).toContainText('4')
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: '新建七版角色' }).click()
  await page.getByLabel('姓名', { exact: true }).fill('关联调查员')
  await page.getByLabel('STR', { exact: true }).fill('65')
  await page.getByLabel('雾港调查（公开测试）', { exact: true }).check()
  await page.getByText('技能', { exact: true }).click()
  await page.getByRole('button', { name: /添加技能$/ }).click()
  await page.getByLabel('技能30名称', { exact: true }).fill('自定义调查')
  await page.getByText('武器战斗表', { exact: true }).click()
  await page.getByRole('button', { name: /添加武器$/ }).click()
  await page.getByLabel('武器1名称', { exact: true }).fill('公开测试武器')
  await page.getByLabel('武器1伤害', { exact: true }).fill('1D4')
  await page.getByLabel('个人描述', { exact: true }).fill('公开背景')
  await page.getByRole('combobox', { name: '角色规则版次', exact: true }).click()
  await page.getByRole('option', { name: '第六版', exact: true }).click()
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await page.getByRole('button', { name: /关联调查员/ }).click()
  await expect(page.getByText('自定义调查', { exact: true })).toBeVisible()
  await expect(page.getByText('13', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '测试系统返回键' }).click()
  await expect(page.getByRole('button', { name: /关联调查员/ })).toBeVisible()
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await page.getByRole('button', { name: '模组 雾港调查（公开测试）', exact: true }).dblclick()
  await page.getByRole('button', { name: /添加参与者$/ }).click()
  await page.getByLabel('PL1', { exact: true }).fill('公开玩家')
  await page.getByRole('combobox', { name: 'PC1', exact: true }).click()
  await page.getByRole('option', { name: /关联调查员/ }).click()
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await page.getByRole('button', { name: '角色卡', exact: true }).click()
  await page.getByRole('button', { name: /关联调查员/ }).click()
  await page.getByRole('button', { name: '返回角色列表', exact: true }).click()
  const characterRow = page
    .locator('.gesture-row')
    .filter({ has: page.locator('.record-card').filter({ hasText: '关联调查员' }) })
  await swipeLeft(page, characterRow)
  await characterRow.getByRole('button', { name: '删除角色卡 关联调查员', exact: true }).click()
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await page.getByRole('button', { name: '模组 雾港调查（公开测试）', exact: true }).dblclick()
  await expect(page.getByLabel('PC1', { exact: true })).toHaveValue('关联调查员')
  await expect(page.getByLabel('关联角色1', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '取消编辑', exact: true }).click()
  const moduleRow = page
    .locator('.gesture-row')
    .filter({ has: page.locator('[data-module-toggle]').filter({ hasText: '雾港调查' }) })
  await swipeLeft(page, moduleRow)
  await moduleRow.getByRole('button', { name: '删除模组 雾港调查（公开测试）', exact: true }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await expect(page.getByRole('region', { name: '数据统计' })).toContainText('2')
  await page.screenshot({ path: 'test-results/settings-412.png' })
})

test('海豹压缩协议获取、失败保留正文、自动备份和多格式文件', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await ready(page)
  await expandModules(page)
  await page.getByRole('button', { name: '新增在线场次' }).first().click()
  await page.getByLabel('场次名称', { exact: true }).fill('网络契约测试')
  await page
    .getByLabel('海豹日志链接', { exact: true })
    .fill('https://log.weizaima.com/?key=browser-contract-test')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expandModules(page)
  await page.getByRole('button', { name: /雾港调查.*网络契约测试/ }).click()
  let fail = false
  await page.route('**/_logbook/sea?*', (route) => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('url')).toContain('key=browser-contract-test')
    const payload = {
      data: Buffer.from(
        zlibSync(
          new TextEncoder().encode(
            JSON.stringify({ messages: [{ nickname: '公开主持人', content: '通过网络边界获取的中文正文' }] })
          )
        )
      ).toString('base64')
    }
    return route.fulfill({
      json: {
        status: fail ? 503 : 200,
        url: 'https://dice-api.weizaima.com/dice/api/load_data',
        text: JSON.stringify(payload)
      }
    })
  })
  await page.getByRole('button', { name: '获取/刷新正文' }).click()
  await expect(page.getByText('通过网络边界获取的中文正文', { exact: true })).toBeVisible()
  fail = true
  await page.getByRole('button', { name: '获取/刷新正文' }).click()
  await expect(page.getByText('通过网络边界获取的中文正文', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('1 个失败')
  await page.getByRole('button', { name: '关闭错误提示' }).click()
  await expect(page.getByText('通过网络边界获取的中文正文', { exact: true })).toBeVisible()
  for (const format of ['raw', 'doc', 'dialogue-doc', 'docx', 'pdf']) {
    await page.getByRole('button', { name: '更多导出格式' }).click()
    await page.getByRole('combobox', { name: '文件格式', exact: true }).click()
    await page
      .getByRole('option', {
        name: (
          {
            raw: '原始 JSON',
            doc: '带图 DOC',
            'dialogue-doc': '纯对话 DOC',
            docx: 'DOCX',
            pdf: 'PDF'
          } as Record<string, string>
        )[format],
        exact: true
      })
      .click()
    await page.getByRole('button', { name: '保存导出文件' }).click()
    await expect(page.getByRole('status')).toContainText('1 个文件')
  }
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await page.getByText(/测试文件（/).click()
  const pdfDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '网络契约测试.pdf', exact: true }).click()
  const pdf = await readFile((await (await pdfDownload).path())!)
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  const docxDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '网络契约测试.docx', exact: true }).click()
  const docx = await readFile((await (await docxDownload).path())!)
  expect(new TextDecoder().decode(unzipSync(docx)['word/document.xml'])).toContain('中文正文')
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await page.clock.install()
  await page.getByLabel('启用自动备份').check()
  await expect(page.getByRole('status', { name: '普通保存状态' })).toHaveText('已保存')
  await page.clock.fastForward(590000)
  await expect(page.getByText('尚未生成自动备份', { exact: true })).toBeVisible()
  await page.clock.fastForward(10000)
  await expect(page.getByText(/^上次成功：/)).toBeVisible()
  await expect(page.locator('.operation-feedback [role=status]')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  await expect(page.getByLabel('启用自动备份')).toBeChecked()
  await page.getByRole('button', { name: '导出记录 Excel', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('记录表格已保存')
  await page.getByRole('button', { name: '刷新归档文件' }).click()
  await expect(page.getByRole('button', { name: /打开 COC跑团记录.xlsx/ })).toBeVisible()
  await page.getByRole('button', { name: '保存含归档 ZIP 备份', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('.zip')
  expect(errors).toEqual([])
})

test('表格预览追加与返回键保护未保存编辑', async ({ page }) => {
  await ready(page)
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入场次表格', exact: true }).click()
  await (
    await chooser
  ).setFiles({
    name: 'public.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      '模组名,场次名,海豹链接,KP1,PC1,PL1\n表格模组,表格场次,https://log.weizaima.com/?key=table-test,主持人,角色名,玩家名'
    )
  })
  await expect(page.getByRole('dialog', { name: '表格导入预览' })).toContainText('表格场次')
  await page.getByRole('button', { name: '确认添加表格数据' }).click()
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await expandModules(page)
  await page.getByRole('button', { name: /表格模组.*表格场次/ }).click()
  await page.getByRole('button', { name: '编辑场次', exact: true }).click()
  await page.getByLabel('场次名称', { exact: true }).fill('应丢弃')
  await page.getByRole('button', { name: '测试系统返回键' }).click()
  await expect(page.getByRole('heading', { name: '表格场次', exact: true })).toBeVisible()
})
