/**
 * 0.7.9：全模组正文搜索不能把应用搞死。
 *
 * 用户反馈（严重）：「跑团记录页面，全模组正文搜索框，输入任意字符会导致应用死机，
 * 只能强行退出。这个是最基础的功能，怎么还能被破坏？」
 *
 * 实测到的崩法：searchOutline 收到的是 { text, depth }[] 而不是 string[]，
 * 调 line.toLocaleLowerCase() 抛 TypeError，React 渲染异常卸载整棵组件树，
 * 页面变全白（document.body.innerText 长度为 0）。
 *
 * 这条用例在真实应用里输入关键词，断言：
 *   1. 页面依然有内容（不是白屏）
 *   2. 搜索框还在
 *   3. 渲染进程没有抛错
 *   4. 结果区正常出现
 *
 * 库里带一份**导图**资源是复现的前提：崩溃发生在「导图大纲命中」这条路径上，
 * 没有导图就碰不到那段代码。
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AppDatabase } from '../../src/main/database'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const executablePath = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')

/** 找一份本机存在的导图，用于触发大纲搜索那条路径 */
const MINDMAP_CANDIDATES = [
  'F:\\3-其他内容\\跑团\\1-世界回归进行曲\\世界回归进行曲.emmx',
  'E:\\COC模组\\龙台掠雪\\龙台掠雪.emmx',
  'E:\\微信文件\\xwechat_files\\wxid_b70gzcimuk4h22_f95c\\msg\\file\\2025-11\\世界回归进行曲.emmx'
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

/** 造一个模组：带若干场正文 + 一份导图（导图是复现崩溃的必要条件） */
function seed(file: string, mindmapPath: string | undefined): void {
  const database = new AppDatabase(file)
  database.initialize()
  database.close()
  const moduleId = '7c2e4f10-3b58-4d9a-9e21-5a6b7c8d9e0f'
  const stamp = '2026-01-01T00:00:00.000Z'
  const raw = new DatabaseSync(file)
  raw
    .prepare(
      `INSERT INTO modules (id,name,kps_json,pairs_json,sort_order,collapsed,created_at,updated_at,play_status)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(moduleId, '世界回归进行曲', '[]', '[]', 0, 0, stamp, stamp, 'ongoing')

  // 一条带正文的场次：正文里要有能被搜到的词
  const rawContent = {
    title: '第一场',
    sourceUrl: 'https://example.com/log',
    responseHash: 'x'.repeat(64),
    parserVersion: 1,
    messages: Array.from({ length: 40 }, (_, index) => ({
      id: String(index),
      order: index,
      timestamp: '2026-01-01T00:00:00.000Z',
      displayName: index % 2 ? 'KP' : '调查员',
      text: index % 3 === 0 ? '调查员开始调查这间屋子' : '众人继续前进',
      type: 'text',
      isDiceCommand: false,
      isOffTopic: false,
      images: [],
      raw: { id: index }
    }))
  }
  raw
    .prepare(
      `INSERT INTO records (id,module_id,name,sequence_no,link,source_type,status,previous_status,play_date,date_source,fetched_at,raw_json,manual_content,cache_source_url,last_error,sort_order,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      'rec-1',
      moduleId,
      '世界回归进行曲第 1 场',
      1,
      null,
      'seal',
      'fetched',
      null,
      '2026-01-01',
      'manual',
      stamp,
      JSON.stringify(rawContent),
      null,
      null,
      null,
      0,
      stamp,
      stamp
    )

  if (mindmapPath) {
    raw
      .prepare(
        `INSERT INTO module_resources (id,module_id,kind,title,path,url,note,sort_order,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        'res-mindmap',
        moduleId,
        'mindmap',
        '世界回归进行曲',
        mindmapPath,
        null,
        null,
        0,
        stamp,
        stamp
      )
  }
  raw.close()
}

async function openRecordsPage(window: Page): Promise<void> {
  await window.getByRole('button', { name: '跑团记录' }).click()
  await expect(window.locator('.module-search').first()).toBeVisible({ timeout: 15000 })
}

test.describe('0.7.9 module-wide text search stays alive', () => {
  test.skip(!MINDMAP, '本机没有可用的导图样例')

  test('typing in the search box does not blank the page', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-079-search-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'), MINDMAP!)

    const app = await launch(root)
    const window = await app.firstWindow()

    // 渲染进程抛错会让整棵 React 树卸载，这里把它抓下来
    const errors: string[] = []
    window.on('pageerror', (error) => errors.push(error.message))
    window.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })

    await window.waitForLoadState('domcontentloaded')
    await openRecordsPage(window)
    // 等导图大纲预读完（搜索会用到它）
    await window.waitForTimeout(1200)

    const search = window.locator('.module-search').first()

    // 逐字符输入：崩在第一或第二个字符上，所以必须逐个来
    for (const ch of ['调', '查', '员']) {
      await search.pressSequentially(ch, { timeout: 10000 })
      await window.waitForTimeout(200)

      // 页面必须还有内容（白屏时 innerText 为空）
      const bodyLength = await window.evaluate(() => document.body.innerText.length)
      expect(bodyLength, `输入「${ch}」之后页面不该变空白`).toBeGreaterThan(0)

      // 搜索框本身还在
      await expect(search, `输入「${ch}」之后搜索框不该消失`).toBeVisible()
    }

    // 结果区正常出现
    await expect(window.locator('.module-search-results')).toBeVisible({ timeout: 10000 })
    const hits = await window.locator('.module-search-hit').count()
    console.log(`搜到 ${hits} 条结果`)
    expect(hits, '应该搜到正文命中').toBeGreaterThan(0)

    // 输入框里的字确实是敲进去的
    expect(await search.inputValue()).toBe('调查员')

    // 渲染进程没有抛错（原来的 TypeError 会在这里露出来）
    console.log('渲染进程报错:', errors.length ? errors.slice(0, 3).join(' | ') : '(无)')
    expect(errors, '不该有渲染进程报错').toEqual([])

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('a mindmap hit also works (the path that used to crash)', async () => {
    // 崩溃正是发生在「导图大纲命中」这条路径上，所以单独再钉一次
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-079-outline-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'), MINDMAP!)

    const app = await launch(root)
    const window = await app.firstWindow()
    const errors: string[] = []
    window.on('pageerror', (error) => errors.push(error.message))

    await window.waitForLoadState('domcontentloaded')
    await openRecordsPage(window)
    await window.waitForTimeout(1200)

    // 导图里一定有「的」这类高频字
    const search = window.locator('.module-search').first()
    await search.pressSequentially('的', { timeout: 10000 })
    await window.waitForTimeout(400)

    const state = await window.evaluate(() => ({
      bodyLength: document.body.innerText.length,
      outlineHits: document.querySelectorAll('.module-search-hit.outline-hit').length
    }))
    console.log('导图命中:', JSON.stringify(state))
    expect(state.bodyLength, '页面不该变空白').toBeGreaterThan(0)
    // 这条路径就是原来崩掉的那条，必须真的产出导图命中
    expect(state.outlineHits, '应该搜到导图节点命中').toBeGreaterThan(0)
    expect(errors, '不该有渲染进程报错').toEqual([])

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
})
