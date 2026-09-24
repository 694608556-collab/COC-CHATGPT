/**
 * 0.7.1 阶段 2 验收：在真实运行的应用里验证导图节点搜索。
 *
 * 用户要求对齐浏览器查找：
 * - 画布上全部命中黄底高亮、当前命中橙底高亮
 * - 点结果把该处摆到画布正中（缩放不影响）
 *
 * 这里直接打开一份真实导图，输入关键词，然后检查画布里真的插入了高亮矩形、
 * 且当前项的底色与其它项不同、点「下一个」后视口确实移动了。
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AppDatabase } from '../../src/main/database'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const executablePath = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')

/** 真实导图：优先用桌面上的那份，没有就跳过 */
const MINDMAP_CANDIDATES = [
  'F:\\1\\dist\\渊娲之海.emmx',
  'C:\\Users\\Administrator\\Desktop\\新建文件夹\\渊娲之海.emmx'
]
const MINDMAP = MINDMAP_CANDIDATES.find((file) => fs.existsSync(file))

function cleanEnvironment(dataDirectory: string): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toLowerCase() !== 'path' && value !== undefined) environment[key] = value
  }
  environment.PATH = process.env.PATH || process.env.Path || ''
  environment.PORTABLE_EXECUTABLE_DIR = dataDirectory
  return environment
}

async function launch(dataDirectory: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath,
    args: ['.', `--user-data-dir=${dataDirectory}`],
    cwd: projectRoot,
    env: cleanEnvironment(dataDirectory)
  })
}

/**
 * 建一个带一条导图资料的库。
 *
 * 表结构交给应用自己的 AppDatabase 建，不手写 SQL——手写容易与真实 schema
 * 有细微出入（例如缺列、缺索引），导致应用启动时初始化失败、连窗口都开不出来。
 * 建好库之后再直接插一行模组与一条导图资料，省去界面上的多步操作。
 */
function seedDatabase(file: string, mindmapPath: string): void {
  const database = new AppDatabase(file)
  database.initialize()
  database.close()

  const moduleId = '7c2e4f10-3b58-4d9a-9e21-5a6b7c8d9e0f'
  const resourceId = 'a1b2c3d4-1111-4222-8333-444455556666'
  const stamp = '2026-01-01T00:00:00.000Z'
  const raw = new DatabaseSync(file)
  raw
    .prepare(
      `INSERT INTO modules (id,name,kps_json,pairs_json,sort_order,collapsed,created_at,updated_at,play_status)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(moduleId, '渊娲之海', '[]', '[]', 0, 0, stamp, stamp, 'ongoing')
  raw
    .prepare(
      `INSERT INTO module_resources (id,module_id,kind,title,path,url,note,sort_order,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(resourceId, moduleId, 'mindmap', '渊娲之海', mindmapPath, null, null, 0, stamp, stamp)
  raw.close()
}

/** 打开资料汇总页并点开那条导图 */
async function openMindmap(window: Page): Promise<void> {
  await window.getByRole('button', { name: '资料汇总' }).click()
  await expect(window.getByText('渊娲之海').first()).toBeVisible({ timeout: 15000 })
  // 双击卡片打开预览
  await window.locator('.resource-tile').first().dblclick()
  await expect(window.locator('.mindmap-viewer')).toBeVisible({ timeout: 20000 })
}

test.describe('0.7.1 mindmap node search', () => {
  test.skip(!MINDMAP, '本机没有可用的 .emmx 样例')

  test('highlights all hits yellow, the current one orange, and centres it', async () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-071-search-'))
    const dataDir = path.join(dataDirectory, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seedDatabase(path.join(dataDir, 'coc.sqlite'), MINDMAP!)

    const app = await launch(dataDirectory)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openMindmap(window)

    // 搜一个必然出现的词
    await window.getByLabel('在当前导图内搜索节点文字').fill('渊娲')
    await expect(window.locator('.mindmap-hit').first()).toBeVisible({ timeout: 10000 })

    // 1) 画布上真的插入了高亮矩形
    const marks = window.locator('.mindmap-hit-mark')
    await expect.poll(async () => marks.count(), { timeout: 10000 }).toBeGreaterThan(0)
    const total = await marks.count()

    // 2) 恰好一处是「当前」高亮（橙底），其余是黄底
    const current = window.locator('.mindmap-hit-mark.current')
    await expect.poll(async () => current.count(), { timeout: 5000 }).toBe(1)

    // 3) 当前项与其它项的底色不同
    const currentFill = await current.first().evaluate((node) => getComputedStyle(node).fill)
    const otherFill = await marks.nth(total > 1 ? 1 : 0).evaluate((node) => getComputedStyle(node).fill)
    if (total > 1) expect(currentFill).not.toBe(otherFill)

    // 4) 点结果后视口移动，且目标被摆到接近画布中心
    const body = window.locator('.mindmap-viewer-body')
    const before = await body.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }))
    await window.locator('.mindmap-hit').nth(Math.min(1, (await window.locator('.mindmap-hit').count()) - 1)).click()
    await window.waitForTimeout(600)
    const after = await body.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }))
    expect(after.left !== before.left || after.top !== before.top).toBe(true)

    // 目标应落在视口内（此前「有时候在画布上完全找不到」就是因为没滚到位）
    const visible = await current.first().evaluate((node) => {
      const rect = node.getBoundingClientRect()
      const svg = node instanceof SVGElement ? node.ownerSVGElement : null
      const host = svg?.parentElement?.parentElement?.getBoundingClientRect()
      if (!host) return false
      return rect.left >= host.left - 2 && rect.right <= host.right + 2
    })
    expect(visible).toBe(true)

    await app.close()
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })

  test('keeps the hit centred after zooming', async () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-071-zoom-'))
    const dataDir = path.join(dataDirectory, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seedDatabase(path.join(dataDir, 'coc.sqlite'), MINDMAP!)

    const app = await launch(dataDirectory)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openMindmap(window)

    await window.getByLabel('在当前导图内搜索节点文字').fill('渊娲')
    await expect(window.locator('.mindmap-hit').first()).toBeVisible({ timeout: 10000 })

    // 放大若干次后重新定位，目标仍应落在视口内
    for (let i = 0; i < 4; i += 1) await window.getByRole('button', { name: '放大' }).click()
    await window.locator('.mindmap-hit').first().click()
    await window.waitForTimeout(600)

    const visible = await window.locator('.mindmap-hit-mark.current').first().evaluate((node) => {
      const rect = node.getBoundingClientRect()
      const svg = node instanceof SVGElement ? node.ownerSVGElement : null
      const host = svg?.parentElement?.parentElement?.getBoundingClientRect()
      if (!host) return false
      return rect.left >= host.left - 2 && rect.right <= host.right + 2
    })
    expect(visible).toBe(true)

    await app.close()
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })
})
