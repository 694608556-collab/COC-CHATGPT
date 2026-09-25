/**
 * 0.8.2：卡片上移后，四个操作按钮必须仍然点得动。
 *
 * 这是一个真实踩到的可用性 bug：图标与名称上移后，`.resource-tile-preview`
 * 在 DOM 里排在 `.resource-tile-actions` 之后，两者重叠时预览区赢了，
 * 四个按钮**完全点不动**——Playwright 报
 * `<div class="resource-tile-preview"> intercepts pointer events`，
 * 点击超时 30 秒。
 *
 * 这条用例不看样式，直接**真的点一次**每个按钮，确保用户点得动。
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

const FILE_ID = 'a1a1a1a1-1111-4111-8111-111111111111'
const LINK_ID = 'b2b2b2b2-2222-4222-8222-222222222222'

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
  insert.run(FILE_ID, a, 'file', '铸形骸', process.execPath, null, null, 0, stamp, stamp)
  insert.run(LINK_ID, a, 'link', '世界回归进行曲', null, 'https://example.com/x', null, 1, stamp, stamp)
  raw.close()
}

async function openResources(window: Page): Promise<void> {
  await window.getByRole('button', { name: '资料汇总' }).click()
  await expect(window.locator('.resource-groups')).toBeVisible({ timeout: 15000 })
  await window.waitForTimeout(400)
}

test.describe('0.8.2 the action buttons stay clickable after moving the icon up', () => {
  test('every button in the row can actually be clicked', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-082-click-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)

    const tile = window.locator('.resource-tile').filter({ hasText: '铸形骸' }).first()
    await tile.hover()
    // 等按钮行真的可点（未悬停时 pointer-events 是 none）
    await window.waitForFunction(
      () => {
        const hovered = document.querySelector('.resource-tile:hover')
        const actions = hovered?.querySelector('.resource-tile-actions')
        return actions ? getComputedStyle(actions).pointerEvents !== 'none' : false
      },
      undefined,
      { timeout: 5000 }
    )

    // 用 elementFromPoint 看每个按钮的中心点上到底是谁 —— 这才是"点得动"的判据
    const hits = await tile.evaluate((element) => {
      const buttons = [...element.querySelectorAll('.resource-tile-actions button')]
      return buttons.map((button) => {
        const r = button.getBoundingClientRect()
        const x = r.left + r.width / 2
        const y = r.top + r.height / 2
        const top = document.elementFromPoint(x, y)
        return {
          label: button.getAttribute('aria-label') ?? '',
          hitSelf: top === button || button.contains(top),
          hitWhat: top ? `${top.tagName}.${typeof (top as HTMLElement).className === 'string' ? (top as HTMLElement).className : ''}` : 'null'
        }
      })
    })
    console.log('每个按钮中心点的命中对象:')
    for (const hit of hits) console.log(`   ${hit.label} → ${hit.hitWhat}（命中自身=${hit.hitSelf}）`)

    expect(hits.length, '应有四个按钮').toBe(4)
    for (const hit of hits) {
      expect(hit.hitSelf, `「${hit.label}」被 ${hit.hitWhat} 挡住了，点不动`).toBe(true)
    }

    // 真点一次「笔」，确认能打开弹窗（端到端的最终判据）
    await tile.getByRole('button', { name: /修改 .* 的信息/ }).click({ timeout: 10000 })
    await expect(window.getByRole('dialog', { name: '修改资料信息' })).toBeVisible({ timeout: 10000 })
    await window.getByRole('button', { name: '取消' }).click()
    await expect(window.getByRole('dialog', { name: '修改资料信息' })).toBeHidden({ timeout: 10000 })

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('the link placeholder is still skipped by pointer events', async () => {
    // 灰色占位必须点不动，且不挡住旁边的真按钮
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-082-ph-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)

    const linkTile = window.locator('.resource-tile').filter({ hasText: '世界回归进行曲' }).first()
    await linkTile.hover()
    await window.waitForFunction(
      () => {
        const hovered = document.querySelector('.resource-tile:hover')
        const actions = hovered?.querySelector('.resource-tile-actions')
        return actions ? getComputedStyle(actions).pointerEvents !== 'none' : false
      },
      undefined,
      { timeout: 5000 }
    )

    const result = await linkTile.evaluate((element) => {
      const placeholder = element.querySelector('.resource-tile-actions .is-placeholder') as HTMLElement
      const r = placeholder.getBoundingClientRect()
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      const buttons = [...element.querySelectorAll('.resource-tile-actions button')]
      return {
        // 占位本身不该被命中（pointer-events: none），命中的应是它底下的卡片
        hitIsPlaceholder: top === placeholder,
        hitWhat: top ? `${top.tagName}.${typeof (top as HTMLElement).className === 'string' ? (top as HTMLElement).className : ''}` : 'null',
        // 旁边三个真按钮仍然点得动
        buttonsClickable: buttons.map((button) => {
          const br = button.getBoundingClientRect()
          const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2)
          return hit === button || button.contains(hit)
        })
      }
    })
    console.log('灰色占位:', JSON.stringify(result))
    expect(result.hitIsPlaceholder, '灰色占位应点不动').toBe(false)
    expect(result.buttonsClickable.every(Boolean), '旁边的真按钮仍应可点').toBe(true)

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
})
