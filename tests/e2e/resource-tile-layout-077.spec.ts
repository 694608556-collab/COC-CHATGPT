/**
 * 0.7.7：资料卡片的操作图标不再压住内容，卡片尺寸始终一致。
 *
 * 用户反馈「拖拽图标偶尔会出现如截图所示的 bug，除了图标以外的部分宽度
 * 偶尔会不一样」。
 *
 * 实测根因：那排操作按钮（刷新/编辑/文件夹/×）是绝对定位、高 24px、
 * top:4px，而卡片上内边距只有 10px、预览区从 11px 开始——悬停时按钮
 * **必然压住下面的文件图标**，实测重叠 18px。
 *
 * 修法：卡片恒定预留顶部 30px，按钮只做淡入淡出（opacity），
 * 不再靠改变尺寸来显隐。
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

/** 三条标题长短差异很大的资料，用于检查宽度是否被内容撑开 */
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
  insert.run('r1', a, 'file', '短', 'F:\\1\\a1.pdf', null, null, 0, stamp, stamp)
  insert.run(
    'r2',
    a,
    'file',
    '一个相当长的资料标题用来测试宽度是否一致',
    'F:\\1\\a2.pdf',
    null,
    null,
    1,
    stamp,
    stamp
  )
  insert.run('r3', a, 'link', '链接资料', null, 'https://example.com', null, 2, stamp, stamp)
  raw.close()
}

/** 量出每张卡片的尺寸，以及操作按钮与预览区是否重叠 */
async function measureTiles(window: Page): Promise<
  Array<{
    title: string
    w: number
    h: number
    actionsBottom: number
    previewTop: number
    overlap: number
  }>
> {
  return window.evaluate(() => {
    const tiles = [...document.querySelectorAll('.resource-tile')]
    return tiles.map((tile) => {
      const r = tile.getBoundingClientRect()
      const actions = tile.querySelector('.resource-tile-actions')!
      const ar = actions.getBoundingClientRect()
      const preview = tile.querySelector('.resource-tile-preview')!
      const pr = preview.getBoundingClientRect()
      const name = tile.querySelector('.resource-tile-name')
      return {
        title: (name?.textContent || '').slice(0, 10),
        w: Math.round(r.width * 100) / 100,
        h: Math.round(r.height * 100) / 100,
        actionsBottom: Math.round(ar.bottom - r.top),
        previewTop: Math.round(pr.top - r.top),
        // 正数表示按钮压住了预览区
        overlap: Math.round(ar.bottom - pr.top)
      }
    })
  })
}

test.describe('0.7.7 resource tiles never overlap their own icons', () => {
  test('the hover actions do not cover the file icon', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-077-tile-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.getByRole('button', { name: '资料汇总' }).click()
    await expect(window.locator('.resource-groups')).toBeVisible({ timeout: 15000 })
    await window.waitForTimeout(400)

    // 未悬停时按钮不可见
    const idle = await measureTiles(window)
    console.log('未悬停:', JSON.stringify(idle))
    for (const tile of idle) {
      expect(tile.overlap, `「${tile.title}」的按钮不该压住内容（未悬停）`).toBeLessThanOrEqual(0)
    }

    // 悬停后按钮出现，但仍不能压住内容
    await window.locator('.resource-tile').first().hover()
    await window.waitForTimeout(300)
    const hovered = await measureTiles(window)
    console.log('悬停后:', JSON.stringify(hovered))
    for (const tile of hovered) {
      expect(tile.overlap, `「${tile.title}」的按钮不该压住内容（悬停）`).toBeLessThanOrEqual(0)
    }

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('every tile keeps the same size regardless of its title', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-077-tilesize-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.getByRole('button', { name: '资料汇总' }).click()
    await expect(window.locator('.resource-groups')).toBeVisible({ timeout: 15000 })
    await window.waitForTimeout(400)

    const check = async (label: string): Promise<void> => {
      const tiles = await measureTiles(window)
      const widths = [...new Set(tiles.map((tile) => tile.w))]
      const heights = [...new Set(tiles.map((tile) => tile.h))]
      console.log(`${label}: 宽度=${widths.join('/')} 高度=${heights.join('/')}`)
      // 标题长短、文件类型不同，卡片尺寸必须一致（由网格决定，不被内容撑开）
      expect(widths, `${label}：所有卡片宽度应一致`).toHaveLength(1)
      expect(heights, `${label}：所有卡片高度应一致`).toHaveLength(1)
    }

    await check('静止')

    // 悬停第一张：悬停只该换颜色，不该改变尺寸
    await window.locator('.resource-tile').first().hover()
    await window.waitForTimeout(300)
    await check('悬停第一张')

    // 拖拽中：尺寸同样不变（用户反馈「拖拽时偶尔不一样」）
    const box = (await window.locator('.resource-tile').nth(1).boundingBox())!
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await window.mouse.down()
    await window.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 8, { steps: 4 })
    await window.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 20, { steps: 10 })
    await window.waitForTimeout(300)
    await check('拖拽中')
    await window.mouse.up()

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('the action row stays inside the tile', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-077-tilein-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.getByRole('button', { name: '资料汇总' }).click()
    await expect(window.locator('.resource-groups')).toBeVisible({ timeout: 15000 })
    await window.locator('.resource-tile').first().hover()
    await window.waitForTimeout(300)

    const result = await window.evaluate(() => {
      const tile = document.querySelector('.resource-tile')!
      const tr = tile.getBoundingClientRect()
      const actions = tile.querySelector('.resource-tile-actions')!
      const ar = actions.getBoundingClientRect()
      const buttons = [...actions.querySelectorAll('.icon-button')].map((button) => {
        const br = button.getBoundingClientRect()
        return { left: br.left - tr.left, right: br.right - tr.left, width: br.width }
      })
      return {
        tileWidth: tr.width,
        actionsLeft: ar.left - tr.left,
        actionsRight: ar.right - tr.left,
        buttons,
        // 按钮不该伸出卡片（伸出去会盖到相邻卡片上）
        overflows: ar.left < tr.left - 0.5 || ar.right > tr.right + 0.5,
        // 四个按钮等宽
        equalWidths: new Set(buttons.map((b) => Math.round(b.width))).size === 1
      }
    })

    console.log('图标行:', JSON.stringify(result))
    expect(result.overflows, '图标行不该超出卡片').toBe(false)
    expect(result.buttons, '应有四个操作按钮').toHaveLength(4)
    expect(result.equalWidths, '四个按钮应等宽').toBe(true)

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
})
