/**
 * 0.7.1 修复验收：「资料汇总」页不得出现空白页。
 *
 * 用户实测：把模组分组与未归属分组都删掉后，页面上仅有的 3 条资料全在被隐藏的
 * 模组下，于是分组容器渲染了、两个分组却都不显示，页面一片空白，
 * 连页头的添加界面都看不见了。
 *
 * 这里在真实应用里复刻这个状态：一个模组 + 2 条资料，两个分组都标记为已移除，
 * 断言资料仍然可见、添加按钮仍可用。
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

/**
 * 造出用户遇到的状态：一个模组带 2 条资料，且模组分组与未归属分组
 * 都已被标记为「从资料汇总页移除」。
 */
function seedHiddenButNotEmpty(file: string): void {
  const database = new AppDatabase(file)
  database.initialize()
  database.close()

  const moduleId = 'c2530838-d74a-4966-aa28-8f2c4eb1115a'
  const stamp = '2026-01-01T00:00:00.000Z'
  const raw = new DatabaseSync(file)
  raw
    .prepare(
      `INSERT INTO modules (id,name,kps_json,pairs_json,sort_order,collapsed,created_at,updated_at,play_status)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(moduleId, '铸形骸，灯心性，启天命', '[]', '[]', 0, 0, stamp, stamp, 'running')
  const insert = raw.prepare(
    `INSERT INTO module_resources (id,module_id,kind,title,path,url,note,sort_order,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
  insert.run('11111111-1111-4111-8111-111111111111', moduleId, 'file', '小陆-周末晚暮光', 'F:\\1\\a.docx', null, null, 0, stamp, stamp)
  insert.run('22222222-2222-4222-8222-222222222222', moduleId, 'file', '跑团记录', 'F:\\1\\b.docx', null, null, 1, stamp, stamp)
  // 两个分组都标记为已移除（用户此前的操作留下的状态）
  raw
    .prepare('UPDATE settings SET data_json = ? WHERE id = 1')
    .run(
      JSON.stringify({
        hiddenResourceGroups: [moduleId, '__unassigned__'],
        hiddenResourceModules: [moduleId]
      })
    )
  raw.close()
}

async function openResources(window: Page): Promise<void> {
  await window.getByRole('button', { name: '资料汇总' }).click()
  await expect(window.getByRole('button', { name: '+ 链接' })).toBeVisible({ timeout: 15000 })
}

test.describe('0.7.1 fix: resources page never goes blank', () => {
  test('shows a group whose removal was recorded while it still holds resources', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-071-blank-e2e-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seedHiddenButNotEmpty(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)

    // 关键断言：资料必须可见（修复前这里是空白页）
    await expect(window.locator('.resource-tile')).toHaveCount(2, { timeout: 10000 })
    // 用卡片内的名称定位，避免与页面标题/导航里的同名文字混淆
    const names = await window.locator('.resource-tile-name').allTextContents()
    expect(names).toContain('小陆-周末晚暮光')
    expect(names).toContain('跑团记录')
    // 不能落到空白引导页
    await expect(window.locator('.empty-state')).toHaveCount(0)

    // 页头的添加按钮必须始终可用
    await expect(window.getByRole('button', { name: '+ 导图' })).toBeVisible()
    await expect(window.getByRole('button', { name: '+ 链接' })).toBeVisible()
    await expect(window.getByRole('button', { name: '+ 文件' })).toBeVisible()

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('can still add a resource while a hidden group holds resources', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-071-blank-add-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seedHiddenButNotEmpty(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)

    // 添加一条不归属的链接：表单要能打开并保存
    await window.getByRole('button', { name: '+ 链接' }).click()
    await expect(window.getByLabel('链接地址')).toBeVisible({ timeout: 8000 })
    await window.getByLabel('链接地址').fill('https://example.com/added')
    await window.getByRole('button', { name: '保存' }).click()
    // 保存后未归属分组应出现，且资料数变成 3
    await expect(window.locator('.resource-tile')).toHaveCount(3, { timeout: 10000 })

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
})
