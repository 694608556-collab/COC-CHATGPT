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
    // 0.7.5 起折叠的分支不再画出来，行数从 1000+ 降到 689（610 个可见节点）。
    // 门槛只要保证「确实量到了整张图」，不锁死具体数字。
    expect(checked, '应该量到不少文字行').toBeGreaterThan(600)
    expect(overflow, `有 ${overflow.length} 处文字溢出节点框：${overflow.slice(0, 5).join(' / ')}`).toEqual([])

    await app.close()
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })

  /**
   * 0.7.5：用户报的「两个文字框压在第三个框上」。
   *
   * 根因是折叠分支的节点仍在按旧坐标绘制，所以这里直接在浏览器里量
   * **可见节点框两两之间**有没有相交——这才是那个 bug 的真身，
   * 文字溢出与否无关。
   */
  test('draws no two visible node boxes on top of each other', async () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-075-overlap-'))
    const dataDir = path.join(dataDirectory, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seedDatabase(path.join(dataDir, 'coc.sqlite'), MINDMAP!)

    const app = await launch(dataDirectory)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openMindmap(window)
    await expect(window.locator('.mindmap-canvas svg').first()).toBeVisible({ timeout: 20000 })
    await window.waitForTimeout(800)

    const result = await window.evaluate(() => {
      const svg = document.querySelector('.mindmap-canvas svg')!
      const boxes = [...svg.querySelectorAll('rect[data-shape]')].map((rect) => ({
        id: rect.getAttribute('data-shape')!,
        r: rect.getBoundingClientRect()
      }))
      const pairs: string[] = []
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]!.r
          const b = boxes[j]!.r
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          if (ox > 1 && oy > 1) {
            pairs.push(`${boxes[i]!.id}×${boxes[j]!.id} 叠 ${ox.toFixed(0)}×${oy.toFixed(0)}`)
          }
        }
      }
      return { boxes: boxes.length, pairs }
    })

    console.log(`量到 ${result.boxes} 个可见节点框，重叠 ${result.pairs.length} 对`)
    expect(result.boxes).toBeGreaterThan(500)
    expect(result.pairs, `有 ${result.pairs.length} 对节点框重叠：${result.pairs.slice(0, 5).join(' / ')}`).toEqual([])

    // 折叠的分支不该被画出来（用户截图里压住别人的那两个框）
    const drawn = await window.evaluate(() => {
      const svg = document.querySelector('.mindmap-canvas svg')!
      const ids = new Set([...svg.querySelectorAll('rect[data-shape]')].map((r) => r.getAttribute('data-shape')))
      const texts = [...svg.querySelectorAll('text')].map((t) => t.textContent || '')
      return {
        has1382: ids.has('1382'),
        has1385: ids.has('1385'),
        foldBadges: svg.querySelectorAll('[data-fold]').length,
        hasHiddenText: texts.some((t) => t.includes('仅接受绝对实力的威吓'))
      }
    })
    expect(drawn.has1382, '折叠的 1382 不该画出来').toBe(false)
    expect(drawn.has1385, '折叠的 1385 不该画出来').toBe(false)
    expect(drawn.hasHiddenText, '折叠的文字不该出现在画布上').toBe(false)
    // 折叠徽标要画出来，否则内容看起来凭空消失
    expect(drawn.foldBadges, '应有折叠徽标').toBeGreaterThan(5)

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

  /**
   * 0.7.6：滚轮默认滚动，Ctrl+滚轮才缩放。
   *
   * 用户反馈「滚轮缩放会同时影响滚动条」。除了逻辑上没调滚动位置，还有一层
   * 原因是 React 17 起把 onWheel 注册成 passive，里面 preventDefault 无效，
   * 所以原生滚动根本没被拦住。这里在真实窗口里分别发普通滚轮和 Ctrl+滚轮，
   * 量滚动位置与缩放百分比的实际变化。
   */
  test('plain wheel scrolls the canvas, Ctrl+wheel zooms it', async () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-076-wheel-'))
    const dataDir = path.join(dataDirectory, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seedDatabase(path.join(dataDir, 'coc.sqlite'), MINDMAP!)

    const app = await launch(dataDirectory)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openMindmap(window)
    await expect(window.locator('.mindmap-canvas svg').first()).toBeVisible({ timeout: 20000 })
    await window.waitForTimeout(500)

    const body = window.locator('.mindmap-viewer-body')
    const box = (await body.boundingBox())!
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

    const readState = (): Promise<{ scrollTop: number; zoom: string }> =>
      window.evaluate(() => {
        const el = document.querySelector('.mindmap-viewer-body')!
        return {
          scrollTop: el.scrollTop,
          zoom: document.querySelector('.mindmap-zoom')!.textContent || ''
        }
      })

    const before = await readState()

    // ---- 普通滚轮：应当滚动，不缩放 ----
    await window.mouse.wheel(0, 300)
    await window.waitForTimeout(300)
    const afterScroll = await readState()
    console.log(`普通滚轮: scrollTop ${before.scrollTop} → ${afterScroll.scrollTop}，缩放 ${before.zoom} → ${afterScroll.zoom}`)
    expect(afterScroll.scrollTop, '普通滚轮应当滚动画布').toBeGreaterThan(before.scrollTop)
    expect(afterScroll.zoom, '普通滚轮不应改变缩放').toBe(before.zoom)

    // ---- Ctrl+滚轮：应当缩放，滚动位置不被原生滚动带偏 ----
    await window.keyboard.down('Control')
    await window.mouse.wheel(0, -300)
    await window.keyboard.up('Control')
    await window.waitForTimeout(300)
    const afterZoom = await readState()
    console.log(`Ctrl+滚轮: 缩放 ${afterScroll.zoom} → ${afterZoom.zoom}`)
    expect(afterZoom.zoom, 'Ctrl+滚轮应当放大').not.toBe(afterScroll.zoom)
    const toPercent = (text: string): number => Number.parseInt(text.replace('%', ''), 10)
    expect(toPercent(afterZoom.zoom)).toBeGreaterThan(toPercent(afterScroll.zoom))

    await app.close()
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })

  /**
   * 0.7.6：概括括号只描边、不填色。
   *
   * 根因是 <Geometry NoFill="1"> 被忽略，而 <FillFormat> 里还留着与描边同色的绿，
   * 于是括号被填成实心色块（用户的描述是「像在 Illustrator 里把描边设成了填充」）。
   */
  test('strokes summary brackets instead of filling them', async () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-076-summary-'))
    const dataDir = path.join(dataDirectory, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seedDatabase(path.join(dataDir, 'coc.sqlite'), MINDMAP!)

    const app = await launch(dataDirectory)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openMindmap(window)
    await expect(window.locator('.mindmap-canvas svg').first()).toBeVisible({ timeout: 20000 })
    await window.waitForTimeout(500)

    const result = await window.evaluate(() => {
      const svg = document.querySelector('.mindmap-canvas svg')!
      const paths = [...svg.querySelectorAll('path')]
      // 按 data-path-type 区分，不能只看颜色：绿色描边既有概括括号（不填色），
      // 也有 Floating 浮动框（绿底白字，本来就该填）
      const summaries = paths.filter((p) => p.getAttribute('data-path-type') === 'Summary')
      const filledSummaries = summaries.filter((p) => {
        const fill = p.getAttribute('fill')
        return fill !== null && fill !== 'none'
      })
      const boundaries = paths.filter((p) => p.getAttribute('data-path-type') === 'Boundary')
      return {
        summaries: summaries.length,
        filled: filledSummaries.map((p) => p.getAttribute('fill')),
        boundaries: boundaries.length,
        filledBoundaries: boundaries.filter((p) => (p.getAttribute('fill') || 'none') !== 'none').length
      }
    })

    console.log(
      `概括括号 ${result.summaries} 条，其中被填色的 ${result.filled.length} 条；` +
        `可见分组框 ${result.boundaries} 个（填色 ${result.filledBoundaries} 个）`
    )
    expect(result.summaries, '应有概括括号').toBeGreaterThan(3)
    expect(result.filled, `概括括号不该填色：${result.filled.slice(0, 5).join(' ')}`).toEqual([])
    // 这份导图里的分组框都处在被折叠的分支中，画布上看不到，所以只在
    // 「确实画出来了」时要求它铺着底色（别把两种图形一起改坏）；
    // 该不该填色本身由单元测试用构造数据覆盖
    // （tests/emmx-summary-font-wheel-076.test.ts 的 boundary 用例）。
    if (result.boundaries > 0) {
      expect(result.filledBoundaries, '分组框仍应铺底色').toBe(result.boundaries)
    }

    await app.close()
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })

  /**
   * 0.7.6：导图文字用应用自己的字体（内置苹方 / SF Pro），不是写死的微软雅黑。
   */
  test('renders map text with the application font', async () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-076-font-'))
    const dataDir = path.join(dataDirectory, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seedDatabase(path.join(dataDir, 'coc.sqlite'), MINDMAP!)

    const app = await launch(dataDirectory)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openMindmap(window)
    await expect(window.locator('.mindmap-canvas svg').first()).toBeVisible({ timeout: 20000 })
    await window.waitForTimeout(500)

    const fonts = await window.evaluate(() => {
      const svg = document.querySelector('.mindmap-canvas svg')!
      const families = new Set<string>()
      for (const text of svg.querySelectorAll('text')) {
        families.add(text.getAttribute('font-family') || '(无)')
      }
      return [...families]
    })
    console.log('导图文字字体:', JSON.stringify(fonts))
    expect(fonts).toHaveLength(1)
    expect(fonts[0]).not.toContain('Microsoft YaHei')
    expect(fonts[0]).toContain('PingFang SC')

    await app.close()
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })
})
