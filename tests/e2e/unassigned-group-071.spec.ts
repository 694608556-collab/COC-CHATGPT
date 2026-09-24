/**
 * 0.7.1 阶段 3 验收：在真实应用里删掉「未归属模组」分组，刷新后不得复活。
 *
 * 用户反馈「未归属模组无法完全删除，右下角提示也只是移除资料」。
 * 这里造一条未归属的资料，走「连分组一起删」，然后重新载入页面确认分组不再出现。
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

/** 只造一条未归属的资料（不建模组），让页面上只有「未归属模组」这一个分组 */
function seedUnassigned(file: string): void {
  const database = new AppDatabase(file)
  database.initialize()
  database.close()
  const raw = new DatabaseSync(file)
  const stamp = '2026-01-01T00:00:00.000Z'
  raw
    .prepare(
      `INSERT INTO module_resources (id,module_id,kind,title,path,url,note,sort_order,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      'b2c3d4e5-2222-4333-8444-555566667777',
      null,
      'link',
      '未归属的链接',
      null,
      'https://example.com/notion',
      null,
      0,
      stamp,
      stamp
    )
  raw.close()
}

async function launch(dataDirectory: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath,
    args: ['.', `--user-data-dir=${dataDirectory}`],
    cwd: projectRoot,
    env: cleanEnvironment(dataDirectory)
  })
}

async function openResources(window: Page): Promise<void> {
  await window.getByRole('button', { name: '资料汇总' }).click()
  // 不强制要求 .resource-groups 存在：分组被删光后页面会正确地切到空白引导页
  await expect(window.getByRole('button', { name: '+ 链接' })).toBeVisible({ timeout: 15000 })
}

test.describe('0.7.1 unassigned group deletion', () => {
  test('removing the group with its resources keeps it removed after a reload', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-071-unassigned-e2e-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seedUnassigned(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)

    // 未归属分组应在（用分组标题元素判断，不用整页文字——
    // 提示条里也会出现分组名，整页匹配会误判）
    const group = window.locator('.resource-group.unassigned')
    await expect(group).toHaveCount(1)
    await expect(group.locator('.resource-group-name')).toHaveText('未归属模组')
    await expect(window.getByText('未归属的链接')).toBeVisible()

    // 点分组的 × → 选「连分组一起删」
    await window.getByLabel('删除未归属分组').click()
    await window.getByRole('button', { name: '连分组一起删' }).click()

    // 提示词要说「已移除分组」，而不是 0.7.0 那句「已移除…的 N 条资料」
    await expect(window.getByText(/已移除分组「未归属模组」/)).toBeVisible({ timeout: 8000 })

    // 分组与资料都应消失
    await expect(group).toHaveCount(0, { timeout: 8000 })
    await expect(window.getByText('未归属的链接')).toHaveCount(0)

    // 关键：重新载入页面（等价于刷新）后分组不得复活
    await window.reload()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)
    await expect(window.locator('.resource-group.unassigned')).toHaveCount(0, { timeout: 8000 })

    // 库里的隐藏标记要真的落盘
    const raw = new DatabaseSync(path.join(dataDir, 'coc.sqlite'), { readOnly: true })
    const row = raw.prepare('SELECT data_json FROM settings WHERE id = 1').get() as {
      data_json: string
    }
    raw.close()
    const settings = JSON.parse(row.data_json) as { hiddenResourceGroups?: string[] }
    expect(settings.hiddenResourceGroups).toContain('__unassigned__')

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('brings the group back when a resource becomes unassigned again', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-071-unassigned-back-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seedUnassigned(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)

    await window.getByLabel('删除未归属分组').click()
    await window.getByRole('button', { name: '连分组一起删' }).click()
    await expect(window.locator('.resource-group.unassigned')).toHaveCount(0, { timeout: 8000 })

    // 再添加一条不归属任何模组的资料 → 分组必须重新出现，否则资料无处可去
    await window.getByRole('button', { name: '+ 链接' }).click()
    await window.getByLabel('链接地址').fill('https://example.com/second')
    await window.getByRole('button', { name: '保存' }).click()
    await expect(window.locator('.resource-group.unassigned')).toHaveCount(1, { timeout: 8000 })

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
})
