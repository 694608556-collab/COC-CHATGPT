/**
 * 0.8.0：拖拽时的外观必须一致，且不能出现色块。
 *
 * 用户反馈：「拖拽资料仍有底色块，而且经过检测，发现拖动后是否有底色块取决于
 * 鼠标抓取的位置——鼠标在图标上精准拖拽则无底色块，位置在图标周围则会抓取色块，
 * 如果拖拽时出现悬停白字黑底框，则色块宽度和黑底框一致。」
 *
 * 实测到的机制：dragstart 那一刻浏览器把拖拽源（卡片）**截图**做「拖拽影像」。
 * 提示框若正显示着，会连同溢出卡片的部分被一起拍进去——提示框实测 189px 宽、
 * 向上溢出卡片 35px，而卡片只有 106px 宽，于是那个"色块"又宽又高，正好和提示框一样。
 *
 * 修法：dragstart 时同步收掉提示框（DOM 属性 + CSS），并给正在拖的卡片加淡紫描边。
 *
 * 由于合成鼠标事件不会触发浏览器原生拖拽，这里用**直接派发 dragstart/dragend 事件**
 * 的方式验证「标记与样式是否同步生效」——那正是修复的着力点。
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
 * 一个文件类 + 一个链接类资料，覆盖两种卡片的图标与编辑表单。
 *
 * 注意 id 必须是**合法 UUID**：IPC 的 zod schema 用 z.string().uuid() 校验
 * （`const id = z.string().uuid()`），用 'r1' 这类短 id 会被判为
 * 「输入内容不完整或格式不正确」而静默失败——保存点了没反应。
 */
const FILE_ID = 'a1a1a1a1-1111-4111-8111-111111111111'
const LINK_ID = 'b2b2b2b2-2222-4222-8222-222222222222'

function seed(file: string): void {
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
  const insert = raw.prepare(
    `INSERT INTO module_resources (id,module_id,kind,title,path,url,note,sort_order,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
  // 长标题 → 名字会被截断 → 悬停时会弹提示框（这正是色块的来源）
  insert.run(
    FILE_ID,
    a,
    'file',
    '铸形骸，灯心性，启天命26907',
    'F:\\1\\a1.pdf',
    null,
    '原备注',
    0,
    stamp,
    stamp
  )
  insert.run(
    LINK_ID,
    a,
    'link',
    '世界回归进行曲',
    null,
    'https://example.com/very/long/path',
    null,
    1,
    stamp,
    stamp
  )
  raw.close()
}

async function openResources(window: Page): Promise<void> {
  await window.getByRole('button', { name: '资料汇总' }).click()
  await expect(window.locator('.resource-groups')).toBeVisible({ timeout: 15000 })
  await window.waitForTimeout(400)
}

test.describe('0.8.0 dragging looks the same wherever you grab', () => {
  test('dragstart hides the tooltip and outlines the card, synchronously', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-080-drag-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)

    // 先悬停到名字上，让提示框真的弹出来（复现用户「抓图标周边」的情形）
    const wrap = window.locator('.resource-tile-name-wrap').first()
    await wrap.hover()
    await window.waitForFunction(
      () => {
        const target = document.querySelector('.resource-tile:hover .resource-tile-name-wrap')
        return target ? getComputedStyle(target, '::after').content !== 'none' : false
      },
      undefined,
      { timeout: 5000 }
    )
    const beforeTip = await window.evaluate(
      () => getComputedStyle(document.querySelector('.resource-tile-name-wrap')!, '::after').content
    )
    console.log('拖拽前提示框:', beforeTip)
    expect(beforeTip, '悬停名字时提示框应已显示').not.toBe('none')

    // 派发 dragstart（合成鼠标不会触发原生拖拽，但事件处理器是同一套）
    await window.evaluate(() => {
      const tile = document.querySelector('.resource-tile')!
      const event = new Event('dragstart', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', {
        value: { setData: () => undefined, effectAllowed: '' }
      })
      Object.defineProperty(event, 'currentTarget', { value: tile })
      tile.dispatchEvent(event)
    })
    await window.waitForTimeout(120)

    const during = await window.evaluate(() => {
      const tile = document.querySelector('.resource-tile')!
      const wrapEl = tile.querySelector('.resource-tile-name-wrap')!
      const cs = getComputedStyle(tile)
      return {
        bodyMarked: document.body.getAttribute('data-dragging'),
        tileMarked: tile.getAttribute('data-dragging'),
        tipContent: getComputedStyle(wrapEl, '::after').content,
        tileShadow: cs.boxShadow,
        tileBorderColor: cs.borderTopColor,
        tileBorderWidth: cs.borderTopWidth,
        tileBackground: cs.backgroundColor
      }
    })
    console.log('拖拽中:', JSON.stringify(during))

    // 关键：提示框必须被收掉 —— 它就是那个"色块"的来源
    expect(during.tipContent, '拖拽时提示框必须消失（否则会被拍进拖拽影像）').toBe('none')
    expect(during.bodyMarked, 'body 应有拖拽标记').toBe('true')
    expect(during.tileMarked, '被拖的卡片应有拖拽标记').toBe('true')
    /*
     * 卡片本体的描边（0.8.1）。
     *
     * 改用卡片**自身的边框**上色，而不是 inset 阴影：边框本来就存在，
     * 上色不改变盒模型，而且形状（圆角）、尺寸、位置与卡片天然完全一致
     * ——用户反馈过 2px 的 inset 阴影「太粗，且比卡片小一圈」。
     */
    expect(during.tileBorderColor, '被拖的卡片边框应变成主题色').toBe('rgb(109, 69, 245)')
    expect(during.tileShadow, '不该再用 inset 阴影（会看起来比卡片小一圈）').toBe('none')
    expect(
      during.tileBackground === 'rgba(0, 0, 0, 0)' || during.tileBackground === 'transparent',
      `被拖的卡片不该铺底色，实际 ${during.tileBackground}`
    ).toBe(true)

    // dragend 之后标记要清掉，否则以后再也看不到提示框
    await window.evaluate(() => {
      const tile = document.querySelector('.resource-tile')!
      const event = new Event('dragend', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'currentTarget', { value: tile })
      tile.dispatchEvent(event)
    })
    await window.waitForTimeout(120)
    const after = await window.evaluate(() => ({
      bodyMarked: document.body.getAttribute('data-dragging'),
      tileMarked: document.querySelector('.resource-tile')!.getAttribute('data-dragging'),
      tileShadow: getComputedStyle(document.querySelector('.resource-tile')!).boxShadow
    }))
    console.log('拖拽后:', JSON.stringify(after))
    expect(after.bodyMarked, 'dragend 后应清掉 body 标记').toBeNull()
    expect(after.tileMarked, 'dragend 后应清掉卡片标记').toBeNull()
    expect(after.tileShadow, 'dragend 后不该还留着描边').toBe('none')

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
})

test.describe('0.8.0 resource card actions', () => {
  test('a link resource shows a greyed-out, non-clickable folder icon', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-080-link-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)

    // 找到链接类那张卡（标题是「世界回归进行曲」）
    const linkTile = window.locator('.resource-tile').filter({ hasText: '世界回归进行曲' }).first()
    await linkTile.hover()
    await window.waitForTimeout(300)

    const info = await linkTile.evaluate((tile) => {
      const placeholder = tile.querySelector('.resource-tile-actions .is-placeholder')
      if (!placeholder) return { found: false as const }
      const cs = getComputedStyle(placeholder)
      const rect = placeholder.getBoundingClientRect()
      return {
        found: true as const,
        tag: placeholder.tagName,
        hasIcon: Boolean(placeholder.querySelector('svg')),
        opacity: cs.opacity,
        pointerEvents: cs.pointerEvents,
        cursor: cs.cursor,
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    })

    console.log('链接资料的文件夹占位:', JSON.stringify(info))
    expect(info.found, '链接资料应有文件夹占位').toBe(true)
    if (info.found) {
      // 保留图标本身
      expect(info.hasIcon, '占位里应保留文件夹图标').toBe(true)
      // 灰色 + 不可点
      expect(Number(info.opacity), '应置灰').toBeLessThan(0.6)
      expect(info.pointerEvents, '应不可点击').toBe('none')
      expect(info.cursor, '鼠标不该是手型').toBe('default')
      // 保留位置（四格对齐）
      expect(info.width, '应保留宽度以维持四格对齐').toBeGreaterThan(10)
    }

    // 文件类那张卡应当是**可点击**的文件夹按钮
    const fileTile = window.locator('.resource-tile').filter({ hasText: '铸形骸' }).first()
    await fileTile.hover()
    // 等 :hover 真的生效（按钮行由 pointer-events 控制，未悬停时是 none）
    await window.waitForFunction(
      () => {
        const tile = document.querySelector('.resource-tile:hover')
        const actions = tile?.querySelector('.resource-tile-actions')
        return actions ? getComputedStyle(actions).pointerEvents !== 'none' : false
      },
      undefined,
      { timeout: 5000 }
    )
    const fileFolder = await fileTile.evaluate((tile) => {
      const buttons = [...tile.querySelectorAll('.resource-tile-actions button')]
      const folder = buttons.find((b) => b.getAttribute('aria-label')?.includes('所在位置'))
      return folder
        ? {
            clickable: getComputedStyle(folder).pointerEvents !== 'none',
            hasIcon: Boolean(folder.querySelector('svg'))
          }
        : null
    })
    console.log('文件资料的文件夹按钮:', JSON.stringify(fileFolder))
    expect(fileFolder, '文件资料应有可点的文件夹按钮').not.toBeNull()
    expect(fileFolder!.hasIcon, '文件夹按钮里应有图标').toBe(true)
    expect(fileFolder!.clickable).toBe(true)

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('the pencil opens an info editor that saves title, module and note', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-080-edit-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)

    const tile = window.locator('.resource-tile').filter({ hasText: '铸形骸' }).first()
    await tile.hover()
    await window.waitForTimeout(300)

    // 点「笔」
    await tile.getByRole('button', { name: /修改 .* 的信息/ }).click()
    const dialog = window.getByRole('dialog', { name: '修改资料信息' })
    await expect(dialog).toBeVisible({ timeout: 10000 })

    // 打开时应带出当前值
    const titleInput = dialog.getByLabel('标题')
    const noteInput = dialog.getByLabel('备注')
    expect(await titleInput.inputValue()).toBe('铸形骸，灯心性，启天命26907')
    expect(await noteInput.inputValue()).toBe('原备注')
    // 归属模组是自绘下拉
    await expect(dialog.locator('.select-trigger')).toBeVisible()

    // 改标题 + 备注 + 归属到乙团
    await titleInput.fill('改过的标题')
    await noteInput.fill('改过的备注')
    await dialog.locator('.select-trigger').click()
    await dialog.getByRole('option', { name: '乙团' }).click()
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toBeHidden({ timeout: 10000 })

    // 界面上应当看到新标题，且卡片移到了乙团分组
    await expect(window.locator('.resource-tile').filter({ hasText: '改过的标题' })).toBeVisible({
      timeout: 10000
    })
    const groupB = window.locator('.resource-group').filter({ hasText: '乙团' })
    await expect(groupB.locator('.resource-tile').filter({ hasText: '改过的标题' })).toHaveCount(1)

    // 刷新后仍在（确实写进库了）
    await window.reload()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)
    await expect(window.locator('.resource-tile').filter({ hasText: '改过的标题' })).toBeVisible({
      timeout: 10000
    })

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('the editor offers a url field for links and a file picker for files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-080-editkind-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)

    // 链接类：应能改链接地址
    const linkTile = window.locator('.resource-tile').filter({ hasText: '世界回归进行曲' }).first()
    await linkTile.hover()
    await window.waitForTimeout(300)
    await linkTile.getByRole('button', { name: /修改 .* 的信息/ }).click()
    const linkDialog = window.getByRole('dialog', { name: '修改资料信息' })
    await expect(linkDialog).toBeVisible({ timeout: 10000 })
    const urlInput = linkDialog.getByLabel('链接地址')
    expect(await urlInput.inputValue()).toBe('https://example.com/very/long/path')
    await urlInput.fill('https://example.com/changed')
    await linkDialog.getByRole('button', { name: '保存' }).click()
    await expect(linkDialog).toBeHidden({ timeout: 10000 })

    // 文件类：应能重新指定文件
    const fileTile = window.locator('.resource-tile').filter({ hasText: '铸形骸' }).first()
    await fileTile.hover()
    await window.waitForTimeout(300)
    await fileTile.getByRole('button', { name: /修改 .* 的信息/ }).click()
    const fileDialog = window.getByRole('dialog', { name: '修改资料信息' })
    await expect(fileDialog).toBeVisible({ timeout: 10000 })
    await expect(fileDialog.getByRole('button', { name: /重新指定/ })).toBeVisible()
    // 文件类不该出现「链接地址」
    await expect(fileDialog.getByLabel('链接地址')).toHaveCount(0)
    await fileDialog.getByRole('button', { name: '取消' }).click()
    await expect(fileDialog).toBeHidden({ timeout: 10000 })

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('the new-link form no longer pre-fills a Notion placeholder', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-080-placeholder-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    seed(path.join(dataDir, 'coc.sqlite'))

    const app = await launch(root)
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await openResources(window)

    // 打开「添加链接」表单
    await window.getByRole('button', { name: /添加链接|链接/ }).first().click()
    const urlInput = window.getByLabel('链接地址')
    await expect(urlInput).toBeVisible({ timeout: 10000 })
    const placeholder = await urlInput.getAttribute('placeholder')
    console.log('链接地址 placeholder:', JSON.stringify(placeholder))
    expect(placeholder ?? '', '不该再预填 Notion').not.toContain('notion')

    await app.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
})
