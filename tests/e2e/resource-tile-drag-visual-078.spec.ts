/**
 * 0.7.8：拖拽资料时只该看到「图标 + 文件名」，不要整块底色，也不要全名提示框。
 *
 * 用户反馈：
 *   「资料汇总中的图标拖拽还是有整块的底色，我想要的效果是拖拽图标后只有
 *     图标+文件名称，别的杂七杂八的底色都不要，也不需要底部白字黑底的全名称显示框。」
 *
 * 此前两处来源：
 *   1. .resource-tile:hover 会给卡片铺一层 panel2 底色 + 一圈边框；
 *      拖动时鼠标正压在卡片上，那一整块灰色就一直跟着走。
 *   2. 卡片自己挂了 data-tip，鼠标一压上去提示框就冒出来（就是那个白字黑底框）。
 *
 * 现在：悬停/拖拽都不铺底色；全名提示移到**文件名**上（需要时停在那里才显示）。
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AppDatabase } from '../../src/main/database'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const executablePath = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')

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

/** 一条标题很长的资料，用来验证「全名还能查得到」 */
function seed(file: string): void {
  const database = new AppDatabase(file)
  database.initialize()
  database.close()
  const a = '11111111-1111-4111-8111-111111111111'
  const stamp = '2026-01-01T00:00:00.000Z'
  const raw = new DatabaseSync(file)
  raw
    .prepare(
      `INSERT INTO modules (id,name,kps_json,pairs_json,sort_order,collapsed,created_at,updated_at,play_status)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(a, '甲团', '[]', '[]', 0, 0, stamp, stamp, 'running')
  const insert = raw.prepare(
    `INSERT INTO module_resources (id,module_id,kind,title,path,url,note,sort_order,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
  insert.run('r1', a, 'file', '铸形骸，灯心性，启天命26907', 'F:\\1\\a1.pdf', null, null, 0, stamp, stamp)
  insert.run('r2', a, 'file', '世界回归进行曲', 'F:\\1\\a2.pdf', null, null, 1, stamp, stamp)
  raw.close()
}

/** 读出**当前鼠标所在**那张卡片的背景、边框与提示框状态 */
async function readHoveredTileVisuals(window: Page): Promise<{
  background: string
  border: string
  cardTip: string | null
  nameTip: string | null
  tipVisible: boolean
}> {
  return window.evaluate(() => {
    // 用 :hover 找到鼠标真正压着的那张，而不是固定取第一张
    const tile = document.querySelector('.resource-tile:hover') ?? document.querySelector('.resource-tile')!
    const wrap = tile.querySelector('.resource-tile-name-wrap')!
    const cs = getComputedStyle(tile)
    const wrapAfter = getComputedStyle(wrap, '::after')
    const tileAfter = getComputedStyle(tile, '::after')
    return {
      background: cs.backgroundColor,
      border: cs.borderTopColor,
      cardTip: tile.getAttribute('data-tip'),
      nameTip: wrap.getAttribute('data-tip'),
      tipVisible: wrapAfter.content !== 'none' || tileAfter.content !== 'none'
    }
  })
}

/** 背景是透明的判定：rgba(0,0,0,0) 或 transparent */
function isTransparent(color: string): boolean {
  return color === 'rgba(0, 0, 0, 0)' || color === 'transparent'
}

test.describe('0.7.8 dragging a tile shows only the icon and the name', () => {
  test('the tile paints no background and no border on hover', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-078-drag-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.getByRole('button', { name: '资料汇总' }).click()
    await expect(window.locator('.resource-groups')).toBeVisible({ timeout: 15000 })
    await window.waitForTimeout(400)

    const idle = await readHoveredTileVisuals(window)
    console.log('静止:', JSON.stringify(idle))
    expect(isTransparent(idle.background), '静止时不该有底色').toBe(true)

    await window.locator('.resource-tile').first().hover()
    await window.waitForTimeout(300)
    const hovered = await readHoveredTileVisuals(window)
    console.log('悬停卡片:', JSON.stringify(hovered))
    expect(isTransparent(hovered.background), '悬停卡片不该铺底色（用户要的「不要整块底色」）').toBe(true)
    expect(isTransparent(hovered.border), '悬停卡片不该画边框').toBe(true)

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('dragging shows no background and no full-name tooltip', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-078-draging-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.getByRole('button', { name: '资料汇总' }).click()
    await expect(window.locator('.resource-groups')).toBeVisible({ timeout: 15000 })
    await window.waitForTimeout(400)

    const box = (await window.locator('.resource-tile').first().boundingBox())!
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await window.mouse.down()
    await window.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 8, { steps: 4 })
    await window.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 30, { steps: 10 })
    await window.waitForTimeout(400)

    const dragging = await readHoveredTileVisuals(window)
    console.log('拖拽中:', JSON.stringify(dragging))
    expect(isTransparent(dragging.background), '拖拽时不该有整块底色').toBe(true)
    expect(dragging.tipVisible, '拖拽时不该冒出全名提示框').toBe(false)

    // 卡片上根本不该挂 data-tip（挂了就会在拖动时冒出来）
    expect(dragging.cardTip, '卡片不该挂 data-tip').toBeNull()

    await window.mouse.up()
    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('the full name is still available by hovering the file name', async () => {
    // 「不要提示框」不等于「看不到全名」：名字被省略号截断时，
    // 鼠标停在名字上仍能看到完整标题
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-078-tip-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.getByRole('button', { name: '资料汇总' }).click()
    await expect(window.locator('.resource-groups')).toBeVisible({ timeout: 15000 })
    await window.waitForTimeout(400)

    const wrap = window.locator('.resource-tile-name-wrap').first()
    const name = wrap.locator('.resource-tile-name')

    // 名字被截断了（省略号），所以需要提示。
    // 注意量的是内层 span 的 scrollWidth：它 overflow:hidden，文字超出时
    // scrollWidth 会大于 clientWidth（外层的 scrollWidth 被自己约束，量不出来）
    const truncated = await name.evaluate((node) => {
      const el = node as HTMLElement
      return el.scrollWidth > el.clientWidth + 1
    })
    const widths = await name.evaluate((node) => {
      const el = node as HTMLElement
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
    })
    console.log(`文件名是否被截断: ${truncated} ${JSON.stringify(widths)}`)
    expect(truncated, '这条标题应该被截断').toBe(true)

    const tip = await wrap.getAttribute('data-tip')
    console.log(`包装层上的全名提示: ${tip}`)
    expect(tip, '包装层上应有全名提示').toBe('铸形骸，灯心性，启天命26907')

    const before = await readHoveredTileVisuals(window)
    expect(before.tipVisible, '不悬停时不该显示提示').toBe(false)

    // 用 waitForFunction 等提示真的出现，不用固定 sleep：
    // 合成鼠标移动与 CSS :hover 的生效时机在不同负载下不一样，
    // 固定等待偶尔会短于实际耗时（全量跑时机器更忙，就会闪失败）
    await wrap.hover()
    await window.waitForFunction(
      () => {
        const tile = document.querySelector('.resource-tile:hover')
        const target = tile?.querySelector('.resource-tile-name-wrap')
        if (!target) return false
        return getComputedStyle(target, '::after').content !== 'none'
      },
      undefined,
      { timeout: 5000 }
    )
    const after = await readHoveredTileVisuals(window)
    console.log('悬停文件名:', JSON.stringify(after))
    expect(after.tipVisible, '悬停文件名时应显示全名').toBe(true)

    // 悬停卡片中间（非文件名处）不该弹提示 —— 拖动时就是这种情况
    const box = (await window.locator('.resource-tile').first().boundingBox())!
    await window.mouse.move(box.x + box.width / 2, box.y + 20)
    await window.waitForFunction(
      () => {
        const tile = document.querySelector('.resource-tile:hover')
        const target = tile?.querySelector('.resource-tile-name-wrap')
        if (!target) return true
        return getComputedStyle(target, '::after').content === 'none'
      },
      undefined,
      { timeout: 5000 }
    )
    const middle = await readHoveredTileVisuals(window)
    console.log('悬停卡片中间:', JSON.stringify(middle))
    expect(middle.tipVisible, '悬停卡片中间不该弹提示（拖动时同理）').toBe(false)

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('the tile keeps its size whether or not it is hovered', async () => {
    // 去掉底色不能让卡片尺寸变化（上一版刚修过「大小偶尔不一样」）
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-078-size-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.getByRole('button', { name: '资料汇总' }).click()
    await expect(window.locator('.resource-groups')).toBeVisible({ timeout: 15000 })
    await window.waitForTimeout(400)

    const sizes = async (): Promise<string> =>
      window.evaluate(() =>
        [...document.querySelectorAll('.resource-tile')]
          .map((tile) => {
            const r = tile.getBoundingClientRect()
            return `${Math.round(r.width)}x${Math.round(r.height)}`
          })
          .join(',')
      )

    const idle = await sizes()
    await window.locator('.resource-tile').first().hover()
    await window.waitForTimeout(300)
    const hovered = await sizes()
    console.log(`静止=${idle} 悬停=${hovered}`)
    expect(hovered).toBe(idle)

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
})
