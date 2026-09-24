/**
 * 0.7.2 验收：在真实应用里把 A 分组的资料全部拖到 B 分组，A 分组必须保留。
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

/** 造两个模组：甲团带 2 条资料、乙团带 1 条 */
function seed(file: string): { a: string; b: string } {
  const database = new AppDatabase(file)
  database.initialize()
  database.close()
  const a = '11111111-1111-4111-8111-111111111111'
  const b = '22222222-2222-4222-8222-222222222222'
  const stamp = '2026-01-01T00:00:00.000Z'
  const raw = new DatabaseSync(file)
  const insertModule = raw.prepare(
    `INSERT INTO modules (id,name,kps_json,pairs_json,sort_order,collapsed,created_at,updated_at,play_status)
     VALUES (?,?,?,?,?,?,?,?,?)`
  )
  insertModule.run(a, '甲团', '[]', '[]', 0, 0, stamp, stamp, 'running')
  insertModule.run(b, '乙团', '[]', '[]', 1, 0, stamp, stamp, 'running')
  const insertResource = raw.prepare(
    `INSERT INTO module_resources (id,module_id,kind,title,path,url,note,sort_order,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
  insertResource.run('a1a1a1a1-1111-4111-8111-111111111111', a, 'file', '甲一', 'F:\\1\\a1.pdf', null, null, 0, stamp, stamp)
  insertResource.run('a2a2a2a2-2222-4222-8222-222222222222', a, 'file', '甲二', 'F:\\1\\a2.pdf', null, null, 1, stamp, stamp)
  insertResource.run('b1b1b1b1-1111-4111-8111-111111111111', b, 'file', '乙一', 'F:\\1\\b1.pdf', null, null, 0, stamp, stamp)
  raw.close()
  return { a, b }
}

async function openResources(window: Page): Promise<void> {
  await window.getByRole('button', { name: '资料汇总' }).click()
  await expect(window.locator('.resource-groups')).toBeVisible({ timeout: 15000 })
}

test.describe('0.7.2 emptying a group by dragging', () => {
  test('keeps group A visible after all its resources are moved to B', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-072-drag-e2e-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)

    // 两个分组都在，共 3 条资料
    await expect(window.locator('.resource-group')).toHaveCount(3) // 甲团、乙团、未归属
    await expect(window.locator('.resource-tile')).toHaveCount(3)
    const groupA = window.locator('.resource-group').filter({ hasText: '甲团' })
    await expect(groupA.locator('.resource-tile')).toHaveCount(2)

    // 用拖拽把甲团的两条资料依次拖到乙团
    const groupB = window.locator('.resource-group').filter({ hasText: '乙团' })
    for (let i = 0; i < 2; i += 1) {
      const card = window.locator('.resource-group').filter({ hasText: '甲团' }).locator('.resource-tile').first()
      await card.dragTo(groupB.locator('.resource-group-head'))
      await window.waitForTimeout(700)
    }

    // 关键：甲团必须仍在，且名下资料为空
    await expect(window.locator('.resource-group').filter({ hasText: '甲团' })).toHaveCount(1, {
      timeout: 8000
    })
    await expect(
      window.locator('.resource-group').filter({ hasText: '甲团' }).locator('.resource-tile')
    ).toHaveCount(0)
    // 乙团拿到 3 条
    await expect(groupB.locator('.resource-tile')).toHaveCount(3)

    // 刷新后仍然保留（不是靠内存里的临时状态）
    await window.reload()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)
    await expect(window.locator('.resource-group').filter({ hasText: '甲团' })).toHaveCount(1, {
      timeout: 8000
    })

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('keeps the group after dragging its last resource to the unassigned group', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-072-drag-unassigned-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)

    const unassigned = window.locator('.resource-group.unassigned')
    for (let i = 0; i < 2; i += 1) {
      const card = window.locator('.resource-group').filter({ hasText: '甲团' }).locator('.resource-tile').first()
      await card.dragTo(unassigned.locator('.resource-group-head'))
      await window.waitForTimeout(700)
    }

    // 甲团拖空后仍要在
    await expect(window.locator('.resource-group').filter({ hasText: '甲团' })).toHaveCount(1, {
      timeout: 8000
    })
    await expect(unassigned.locator('.resource-tile')).toHaveCount(2)

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
})
