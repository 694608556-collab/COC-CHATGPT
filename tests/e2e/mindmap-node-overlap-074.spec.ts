/**
 * 0.7.4 端到端验收：在真实运行的应用里验证节点文字不再溢出、压到相邻节点。
 *
 * 用户反馈的截图里，节点「应同渊娲一样，为某种计划的产物」被拆成三行、
 * 溢出自己的框、盖住上下两个节点。根因是行数按 `<tp>` 算而不是按 `<pp>` 算。
 *
 * 这里直接打开那份真实导图，在 DOM 里量每一行文字的包围盒，
 * 确认它落在自己所属节点的矩形内——这是用户在屏幕上真正看到的东西。
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AppDatabase } from '../../src/main/database'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const executablePath = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')

/** 用户截图里那份导图 */
const MINDMAP_CANDIDATES = [
  'F:\\3-其他内容\\跑团\\1-世界回归进行曲\\世界回归进行曲.emmx',
  'E:\\微信文件\\xwechat_files\\wxid_b70gzcimuk4h22_f95c\\msg\\file\\2025-11\\世界回归进行曲.emmx',
  'C:\\Users\\Admin\\AppData\\Roaming\\dsh-launcher\\dsh-packs\\pack-test\\attachments\\v1\\files\\f7\\f71ab15e047fbc1b8a3c94e8b2bfa86f2e6169d03f79302a6d8eb91554bba533\\世界回归进行曲.emmx'
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
    .run(moduleId, '世界回归进行曲', '[]', '[]', 0, 0, stamp, stamp, 'ongoing')
  raw
    .prepare(
      `INSERT INTO module_resources (id,module_id,kind,title,path,url,note,sort_order,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(resourceId, moduleId, 'mindmap', '世界回归进行曲', mindmapPath, null, null, 0, stamp, stamp)
  raw.close()
}

async function openMindmap(window: Page): Promise<void> {
  await window.getByRole('button', { name: '资料汇总' }).click()
  await expect(window.getByText('世界回归进行曲').first()).toBeVisible({ timeout: 15000 })
  await window.locator('.resource-tile').first().dblclick()
  await expect(window.locator('.mindmap-viewer')).toBeVisible({ timeout: 20000 })
}

/**
 * 在画布里量出「文字溢出所属节点框」的处数。
 *
 * 注意必须用 `.mindmap-canvas svg`：`.mindmap-viewer` 里还有标题栏按钮等图标 SVG，
 * 用 `.mindmap-viewer svg` 会先命中那些图标，一个 data-shape 都量不到。
 *
 * 对每个节点矩形（rect[data-shape]），找出它自己的 <text>（同 data-shape），
 * 逐行比较文字包围盒与节点框：只要有一行的上下边超出节点框，就算溢出。
 */
async function measureOverflow(window: Page): Promise<{ checked: number; overflow: string[] }> {
  return window.evaluate(() => {
    const svg = document.querySelector('.mindmap-canvas svg')
    if (!svg) return { checked: 0, overflow: ['找不到画布 svg'] }
    const rects = new Map<string, SVGRectElement>()
    for (const rect of svg.querySelectorAll('rect[data-shape]')) {
      const id = rect.getAttribute('data-shape')!
      // 一个节点可能有多块矩形（分组框等），取第一个即节点本体
      if (!rects.has(id)) rects.set(id, rect as SVGRectElement)
    }
    const overflow: string[] = []
    let checked = 0
    for (const text of svg.querySelectorAll('text[data-shape]')) {
      const id = text.getAttribute('data-shape')!
      const rect = rects.get(id)
      if (!rect) continue
      checked++
      const t = text.getBoundingClientRect()
      const r = rect.getBoundingClientRect()
      if (t.height === 0) continue
      // 允许 1px 的浮点/描边误差
      const above = r.top - t.top
      const below = t.bottom - r.bottom
      if (above > 1 || below > 1) {
        overflow.push(
          `id=${id} "${(text.textContent || '').slice(0, 18)}" 文字超出节点框 上${above.toFixed(1)}px 下${below.toFixed(1)}px`
        )
      }
    }
    return { checked, overflow }
  })
}

test.describe('0.7.4 node text stays inside its own box', () => {
  test.skip(!MINDMAP, '本机没有可用的 .emmx 样例')

  test('renders every node line inside its own box', async () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-074-overlap-'))
    const dataDir = path.join(dataDirectory, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seedDatabase(path.join(dataDir, 'coc.sqlite'), MINDMAP!)

    const app = await launch(dataDirectory)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openMindmap(window)

    // 等画布真的画出来
    await expect(window.locator('.mindmap-canvas svg').first()).toBeVisible({ timeout: 20000 })
    await window.waitForTimeout(800)

    const { checked, overflow } = await measureOverflow(window)
    console.log(`量到 ${checked} 行文字，溢出 ${overflow.length} 处`)
    expect(checked, '应该量到不少文字行').toBeGreaterThan(800)
    expect(overflow, `有 ${overflow.length} 处文字溢出节点框：${overflow.slice(0, 5).join(' / ')}`).toEqual([])

    await app.close()
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })

  test('renders the reported node on one line', async () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-074-oneline-'))
    const dataDir = path.join(dataDirectory, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seedDatabase(path.join(dataDir, 'coc.sqlite'), MINDMAP!)

    const app = await launch(dataDirectory)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openMindmap(window)
    await expect(window.locator('.mindmap-canvas svg').first()).toBeVisible({ timeout: 20000 })

    // 用搜索把那个节点找出来，量它实际占了几行
    await window.getByLabel('在当前导图内搜索节点文字').fill('应同渊娲一样')
    await expect(window.locator('.mindmap-hit').first()).toBeVisible({ timeout: 15000 })

    const lines = await window.evaluate(() => {
      const svg = document.querySelector('.mindmap-canvas svg')!
      const hits = [...svg.querySelectorAll('text[data-shape]')].filter((t) =>
        (t.textContent || '').includes('应同渊娲一样')
      )
      return hits.map((t) => t.textContent)
    })

    // 完整一句话应在一行里，而不是被切成「应同渊娲一样，为 / 某个计划 / 的产物」
    console.log('命中行:', JSON.stringify(lines))
    expect(lines.length, `期望 1 行，实际 ${lines.length} 行：${lines.join(' | ')}`).toBe(1)
    expect(lines[0]).toContain('应同渊娲一样，为某种计划的产物')

    await app.close()
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })
})
