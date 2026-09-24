/**
 * 0.7.2 验收：在真实应用里把 A 分组的资料全部拖到 B 分组，A 分组必须保留。
 */
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
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
  // 顺手装上拖拽生命周期跟踪，dragCard 要靠它判断上一次拖拽是否结束。
  // 放在这里而不是每个用例里各写一遍：页面重载后监听会丢失，
  // 跟着打开动作装最不容易漏。
  await trackDragLifecycle(window)
}

/**
 * 在页面里跟踪 HTML5 拖拽的生命周期。
 *
 * 浏览器一次只能有一个拖拽在进行。上一次的 dragend 还没落地就按下一次鼠标，
 * 浏览器仍认为「正在拖拽」，于是第二次的 dragstart 根本不触发，
 * draggingRef 一直是空、分组不会高亮、drop 也不会发生
 * ——这正是本文件三个用例此前随机失败的原因。
 *
 * 装上监听后就能显式等「拖拽真的结束了」，不用靠固定 sleep 猜时间。
 */
async function trackDragLifecycle(window: Page): Promise<void> {
  await window.evaluate(() => {
    const state = window as unknown as { __dragActive: boolean; __dragSeq: number; __dropSeq: number }
    state.__dragActive = false
    // 计数用于判断「这一次手势浏览器有没有真的认成拖拽」
    state.__dragSeq = 0
    state.__dropSeq = 0
    document.addEventListener('dragstart', () => {
      state.__dragActive = true
      state.__dragSeq += 1
    })
    document.addEventListener('dragend', () => {
      state.__dragActive = false
    })
    document.addEventListener('drop', () => {
      state.__dragActive = false
      state.__dropSeq += 1
    })
  })
}

/** 读出已发生的 dragstart / drop 次数，用来确认一次手势是否被浏览器接受 */
async function readDragCounters(window: Page): Promise<{ started: number; dropped: number }> {
  return window.evaluate(() => {
    const state = window as unknown as { __dragSeq?: number; __dropSeq?: number }
    return { started: state.__dragSeq ?? 0, dropped: state.__dropSeq ?? 0 }
  })
}

/** 等上一次拖拽彻底结束（dragend/drop 已触发） */
async function waitForDragIdle(window: Page): Promise<void> {
  await window.waitForFunction(
    () => (window as unknown as { __dragActive?: boolean }).__dragActive !== true,
    undefined,
    { timeout: 5000 }
  )
}

/**
 * 等界面安静下来（连续若干帧没有 DOM 变化）。
 *
 * 落点是异步的：setModule → move → 重新读取快照 → 重渲染。dragend 只说明
 * 浏览器这一侧的拖拽结束了，应用那边的写入与重排可能还在进行。此时若立刻
 * 开始下一次拖拽，正被替换掉的卡片会让浏览器的拖拽中途失效。
 *
 * 用 MutationObserver 等「真的不动了」，比猜一个固定毫秒数可靠。
 */
async function waitForUiQuiet(page: Page, quietMs = 250): Promise<void> {
  await page.evaluate(
    (quiet) =>
      new Promise<void>((resolve) => {
        // 在页面里执行，这里的 window 是浏览器全局；参数名用 page 避免与它冲突
        const view = globalThis as unknown as Window
        let timer = view.setTimeout(done, quiet)
        function done(): void {
          observer.disconnect()
          view.clearTimeout(timer)
          resolve()
        }
        const observer = new MutationObserver(() => {
          view.clearTimeout(timer)
          timer = view.setTimeout(done, quiet)
        })
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        })
      }),
    quietMs
  )
}

/**
 * 手动分步拖拽，替代 locator.dragTo。
 *
 * 三个坑都要绕开：
 *  1. dragTo 只做「按下 → 一次 move → 松开」，Chromium 有时不把它识别成
 *     HTML5 拖拽的开始，dragstart 不触发、drop 也不触发。所以要分多步移动；
 *  2. 上一次落点处理完会重新读取资料列表并重排，若在重排过程中取
 *     boundingBox()，拿到的还是旧坐标，鼠标就按在了空处。先用 hover()
 *     等元素稳定（Playwright 会等到包围盒连续两帧不变）再取坐标；
 *  3. **上一次拖拽没结束就按下一次**（见 trackDragLifecycle 的说明）。
 *
 * 注意不要用 `.drop-target` 高亮当「可以松手」的信号：它由 onDragLeave 清除，
 * 鼠标在子元素之间移动时会闪一下就没了，等它必定超时。放置是否成功由调用方
 * 断言资料归属的变化来判断——那才是真正要保证的东西。
 */
async function dragCard(window: Page, from: Locator, to: Locator, attempt = 1): Promise<void> {
  // 先确认没有未结束的拖拽，且上一次落点引起的重排已经结束
  // （见 waitForUiQuiet 的说明：正被替换的卡片会让拖拽中途失效）
  await waitForDragIdle(window)
  await waitForUiQuiet(window)

  const before = await readDragCounters(window)

  // hover 会等元素可见且位置稳定，顺便把鼠标移过去
  await from.hover()
  const source = await from.boundingBox()
  const target = await to.boundingBox()
  if (!source || !target) throw new Error('拖拽的起点或终点不在可见区域内')

  const startX = source.x + source.width / 2
  const startY = source.y + source.height / 2
  const endX = target.x + target.width / 2
  const endY = target.y + target.height / 2

  await window.mouse.move(startX, startY)
  await window.mouse.down()
  // 先小幅移动，越过浏览器的拖拽启动阈值
  await window.mouse.move(startX + 8, startY + 8, { steps: 4 })
  // 再分几步走到目标，触发 dragover / dragenter
  await window.mouse.move(endX, endY, { steps: 12 })
  // 停一下让 React 处理完 dragover，再原地轻移一次确认落点，最后松手
  await window.waitForTimeout(80)
  await window.mouse.move(endX + 1, endY + 1, { steps: 2 })
  await window.mouse.up()
  // 等这次拖拽彻底结束，再让调用方继续（调用方随后断言归属变化）
  await waitForDragIdle(window)

  const after = await readDragCounters(window)
  // 合成手势本身可能不被 Chromium 认成 HTML5 拖拽（dragstart/drop 都没触发）。
  // 这属于测试环境的手势问题，不是产品行为，重试一次；
  // 但若拖拽确实发生了（计数增加）却没能搬动资料，那就是真的 bug——
  // 这里不重试，交给调用方的断言去失败。
  if (after.started === before.started && after.dropped === before.dropped) {
    if (attempt >= 3) throw new Error('合成拖拽手势连续 3 次都没被浏览器接受')
    await window.waitForTimeout(120)
    await dragCard(window, from, to, attempt + 1)
  }
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

    // 用拖拽把甲团的两条资料依次拖到乙团。
    //
    // 每次都等「甲团的卡片真的少了一张」再拖下一次，不用固定 waitForTimeout：
    // 落点处理是异步的（setModule + move + 重新读取），固定等待偶尔会短于
    // 实际耗时，于是第二次拖拽抓到的还是上一次的卡片——这个用例此前会随机失败。
    const groupB = window.locator('.resource-group').filter({ hasText: '乙团' })
    for (let remaining = 1; remaining >= 0; remaining -= 1) {
      const card = window.locator('.resource-group').filter({ hasText: '甲团' }).locator('.resource-tile').first()
      await dragCard(window, card, groupB.locator('.resource-group-head'))
      await expect(
        window.locator('.resource-group').filter({ hasText: '甲团' }).locator('.resource-tile')
      ).toHaveCount(remaining, { timeout: 8000 })
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
    // 同前：等「甲团少了一张」再拖下一次，不用固定等待
    for (let remaining = 1; remaining >= 0; remaining -= 1) {
      const card = window.locator('.resource-group').filter({ hasText: '甲团' }).locator('.resource-tile').first()
      await dragCard(window, card, unassigned.locator('.resource-group-head'))
      await expect(
        window.locator('.resource-group').filter({ hasText: '甲团' }).locator('.resource-tile')
      ).toHaveCount(remaining, { timeout: 8000 })
    }

    // 甲团拖空后仍要在
    await expect(window.locator('.resource-group').filter({ hasText: '甲团' })).toHaveCount(1, {
      timeout: 8000
    })
    await expect(unassigned.locator('.resource-tile')).toHaveCount(2)

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  /**
   * 0.7.6：拖拽不能再「随机失效」。
   *
   * dragstart 之后、dragover 之前 React 可能还没重渲染，此时事件回调里读到的
   * dragging state 仍是 undefined，onDragOver 里的 `if (!dragging) return`
   * 就直接返回、没调 preventDefault，浏览器认为「这里不接受放置」而丢掉 drop。
   * 表现为拖了但什么都没发生——上面两个用例此前会随机有一个失败。
   *
   * 这里连续拖 4 次并要求每次都必须生效，把这个竞态钉死。
   */
  test('every drag actually lands, not just most of them', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-076-drag-race-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)

    const groupA = window.locator('.resource-group').filter({ hasText: '甲团' })
    const groupB = window.locator('.resource-group').filter({ hasText: '乙团' })
    // seed：甲团 2 条、乙团 1 条
    await expect(groupA.locator('.resource-tile')).toHaveCount(2)
    await expect(groupB.locator('.resource-tile')).toHaveCount(1)

    // 甲 → 乙，再 乙 → 甲，来回两轮共 4 次，每次都必须真的搬过去
    for (let round = 0; round < 2; round += 1) {
      await dragCard(
        window,
        groupA.locator('.resource-tile').first(),
        groupB.locator('.resource-group-head')
      )
      await expect(groupB.locator('.resource-tile'), `第 ${round * 2 + 1} 次拖拽应当生效`).toHaveCount(2, {
        timeout: 5000
      })
      await expect(groupA.locator('.resource-tile')).toHaveCount(1)
      await dragCard(
        window,
        groupB.locator('.resource-tile').first(),
        groupA.locator('.resource-group-head')
      )
      await expect(groupA.locator('.resource-tile'), `第 ${round * 2 + 2} 次拖拽应当生效`).toHaveCount(2, {
        timeout: 5000
      })
      await expect(groupB.locator('.resource-tile')).toHaveCount(1)
    }

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  /**
   * 0.7.6：拖到**另一张卡片**上（组内排序）。
   *
   * 前面三个用例的落点都是分组头部，走的是分组自己的 onDragOver；
   * 而卡片上也有一套 onDragOver/onDrop（用于组内排序），两者是不同的代码路径。
   * 这条用例专门覆盖卡片那条，否则卡片上的守卫写错了也不会被发现。
   */
  test('reorders within a group when dropping onto another card', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-076-drag-reorder-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)

    const groupA = window.locator('.resource-group').filter({ hasText: '甲团' })
    const names = (): Promise<string[]> =>
      groupA.locator('.resource-tile-name').allTextContents()

    // seed 里甲团是「甲一、甲二」
    expect(await names()).toEqual(['甲一', '甲二'])

    // 把第二张拖到第一张上：应当变成「甲二、甲一」
    await dragCard(window, groupA.locator('.resource-tile').nth(1), groupA.locator('.resource-tile').first())

    await expect
      .poll(names, { timeout: 5000, message: '组内拖拽应当改变卡片顺序' })
      .toEqual(['甲二', '甲一'])
    // 数量不变，说明是排序而不是搬家
    await expect(groupA.locator('.resource-tile')).toHaveCount(2)

    // 刷新后顺序仍然保留（确实写进了数据库，不是内存里的临时状态）
    await window.reload()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)
    expect(await names()).toEqual(['甲二', '甲一'])

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
})
