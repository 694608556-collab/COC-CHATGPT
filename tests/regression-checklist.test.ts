/**
 * 历史问题逐项回归清单。
 *
 * 这里集中复测「用户提过多次、反复修过」的点，确保它们在同一版本里同时成立。
 * 每一条都对应一次真实的用户反馈，失败即表示该问题复发。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pageToSvg, parseEmmx } from '../src/shared/emmx'
import { parseMindmapHtml } from '../src/shared/mindmap-html'
import { samplePath } from './sample-files'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

// 两台开发机上样例的存放位置不同，按逻辑名解析；缺失时对应用例自动跳过
const EMMX = samplePath('龙台掠雪')
const CALLOUT_EMMX = samplePath('锈蚀纪元')
const HTML = samplePath('铸形骸html')

describe('regression checklist: previously reported issues', () => {
  const app = read('src/renderer/src/App.tsx')
  const page = read('src/renderer/src/components/ResourcesPage.tsx')
  const viewer = read('src/renderer/src/components/MindmapViewer.tsx')
  const styles = read('src/renderer/src/styles.css')
  const ipc = read('src/main/ipc.ts')
  const database = read('src/main/database.ts')
  const emmx = read('src/shared/emmx.ts')

  it('0.6.1 window: keeps the native square frame and eight-way resizing', () => {
    const main = read('src/main/index.ts')
    expect(main).toContain('thickFrame: true')
    expect(main).toContain('resizable: true')
    expect(main).toContain('roundedCorners: false')
  })

  it('0.6.2 numbering: default session number continues from the largest used', () => {
    const repository = read('src/main/repository.ts')
    expect(repository).toContain('largestUsed + 1')
  })

  it('0.6.3 play status: mandatory picker and badge', () => {
    expect(app).toContain('请选择跑团状态')
    expect(app).toContain('MODULE_PLAY_STATUSES.map')
    expect(app).toContain('play-status-badge')
  })

  it('0.6.3 archive directory: reports the real path and offers a reset', () => {
    const archivePath = read('src/main/archive-path.ts')
    expect(archivePath).toContain('ARCHIVE_DIRECTORY_UNAVAILABLE')
    expect(archivePath).toContain('inspectArchiveDirectory')
    expect(app).toContain('恢复默认位置')
  })

  it('0.6.3 note images: CSP allows coc-media so pictures actually render', () => {
    const sourceHtml = read('src/renderer/index.html')
    const csp = sourceHtml.slice(sourceHtml.indexOf('Content-Security-Policy'))
    const imgSrc = csp.slice(csp.indexOf('img-src'), csp.indexOf(';', csp.indexOf('img-src')))
    expect(imgSrc).toContain('coc-media:')
  })

  it('0.6.3 note board: the editing card is not rendered twice', () => {
    const board = read('src/renderer/src/components/NoteBoard.tsx')
    expect(board).toContain('.filter((note) => note.id !== draft?.id)')
  })

  it('0.6.7 caption buttons: Windows 10 style, 32px bar', () => {
    expect(styles).toContain('--titlebar-height: 32px')
    expect(styles).toContain('.caption-button')
    expect(styles).not.toContain('#f0b429')
  })

  it('0.6.8 resources: page sits between characters and notes', () => {
    expect(app).toContain("type Page = 'records' | 'characters' | 'resources' | 'notes' | 'settings'")
  })

  it('0.7.0 connector labels: relationship text is read and placed correctly', () => {
    expect(emmx).toContain('RelatConnector')
    expect(emmx).toContain('readLabel')
  })

  it.skipIf(EMMX === undefined)('0.7.0 node text: uses own text box and wraps long lines', () => {
    const document = parseEmmx(fs.readFileSync(EMMX!))
    const main = document.pages.find((item) => item.name === 'page/page.xml')!
    // 每个节点都有自己的文字区域
    expect(main.shapes.filter((shape) => shape.textBox).length).toBeGreaterThan(main.shapes.length * 0.9)
    // 折行生效：SVG 里不应有超出画布宽度的单行
    const svg = pageToSvg(main)
    const canvasWidth = main.bounds.maxX - main.bounds.minX
    for (const m of svg.matchAll(/<text[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)) {
      const size = Number(m[1])
      let width = 0
      for (const ch of m[2]!) width += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? size : size * 0.55
      expect(width).toBeLessThan(canvasWidth)
    }
  })

  it.skipIf(CALLOUT_EMMX === undefined)('0.7.0 callouts: box text is visible, not just the box', () => {
    const document = parseEmmx(fs.readFileSync(CALLOUT_EMMX!))
    const main = document.pages.find((item) => item.name === 'page/page.xml')!
    const texts = main.labels.flatMap((label) => label.lines)
    expect(texts.some((text) => text.includes('琉星为何会知道黑蛇相关信息'))).toBe(true)
  })

  it('0.7.0 viewer: centers on open, wheel zoom, drag pan, no wrapping buttons', () => {
    expect(viewer).toContain('centerView')
    expect(viewer).toContain('onWheel')
    // 0.7.7 起拖拽改用 Pointer Events（配合 setPointerCapture，
    // 指针移出窗口后也能继续拖动）
    expect(viewer).toContain('onPointerDown')
    const tools = styles.slice(styles.indexOf('.mindmap-tab,'), styles.indexOf('.mindmap-tab:hover'))
    expect(tools).toContain('white-space: nowrap')
  })

  it('0.7.0 viewer: zoom readout is fixed width and sits left of the zoom-out button', () => {
    const tools = viewer
      .slice(viewer.indexOf('mindmap-viewer-tools'), viewer.indexOf('mindmap-hits'))
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    expect(tools.indexOf('mindmap-zoom')).toBeLessThan(tools.indexOf('缩小'))
    expect(styles).toContain('.mindmap-zoom')
  })

  it.skipIf(HTML === undefined)('0.7.0 sub-pages: real canvas names instead of 画布 N', () => {
    const document = parseMindmapHtml(fs.readFileSync(HTML!, 'utf8'))
    expect(document.pages.map((item) => item.title)).toEqual([
      '主内容',
      '待探索调查',
      '卷宗',
      '冬蛾相关'
    ])
  })

  it('0.7.0 new emmx format: explains to export HTML instead of failing silently', () => {
    expect(emmx).toContain('EMMX_NEW_FORMAT')
    expect(page).toContain('这个导图需要先导出为 HTML')
  })

  it('0.7.0 resources page: no duplicate add buttons, no per-card owner dropdown', () => {
    expect(page).not.toContain('resource-toolbar')
    expect(page).not.toContain('resource-tile-owner')
    expect(styles).not.toContain('.resource-toolbar')
    expect(styles).not.toContain('.resource-tile-owner')
  })

  it('0.7.0 resources page: drag to change owner and reorder', () => {
    expect(page).toContain('draggable')
    expect(page).toContain('dropInto')
    expect(styles).toContain('.resource-group.drop-target')
  })

  it('0.7.0 resources page: hover actions including update (0.7.1: four icons)', () => {
    const actions = page.slice(page.indexOf('resource-tile-actions'), page.indexOf('const renderGroup'))
    expect(actions).toContain('RefreshIcon')
    expect(actions).toContain('<FolderIcon')
    expect(actions).toContain('<XIcon')
    expect(actions.indexOf('RefreshIcon')).toBeLessThan(actions.indexOf('<FolderIcon'))
    // 0.7.1：新增「编辑」图标（用原程序打开），插在更新与文件夹之间
    expect(actions).toContain('<PencilIcon')
    expect(actions.indexOf('RefreshIcon')).toBeLessThan(actions.indexOf('<PencilIcon'))
    expect(actions.indexOf('<PencilIcon')).toBeLessThan(actions.indexOf('<FolderIcon'))
    // 四个图标等宽占满一行
    expect(styles).toContain('repeat(4')
  })

  it('0.7.0 image thumbnails: dedicated read channel, not the notes-only protocol', () => {
    expect(ipc).toContain("'resources:read-image'")
    expect(page).toContain('window.coc.resources.readImage')
    expect(page).not.toContain('coc-media://')
  })

  it('0.7.0 link icon: svg glyph instead of an emoji', () => {
    expect(page).toContain('LinkGlyph')
    expect(page).not.toContain("'🔗'")
  })

  it('0.7.0 tooltips: app-styled tooltip, never the black browser one', () => {
    expect(page).not.toContain('用原程序打开（编辑仍在原软件里进行）')
    // 0.7.0 用的还是原生 title（系统黑底方块）；0.7.1 换成自绘浮层
    expect(page).not.toContain('title="用原程序打开"')
    expect(page).toContain('data-tip=')
    expect(styles).toContain('[data-tip]:hover::after')
  })

  it('0.7.0 group deletion: same two choices everywhere, no 取消归属 middle state', () => {
    const block = page.slice(page.indexOf('const removeGroup'), page.indexOf('const toggle'))
    expect(block).toContain('只清空资料')
    expect(block).toContain('连分组一起删')
    expect(block).not.toContain('取消归属')
  })

  it('0.7.0 group deletion: removing a module group never touches the module', () => {
    expect(ipc).toContain("'resources:remove-group'")
    expect(database).toContain('module_resources')
    // 只写一个标记到设置里，不删模组
    const repository = read('src/main/repository.ts')
    expect(repository).toContain('hideResourceGroup')
    expect(repository).toContain('hiddenResourceModules')
  })

  it('0.7.0 schema: v7 keeps resources nullable so unassigned ones survive', () => {
    expect(database).toContain('module_resources_v7')
    expect(database).toContain('if (currentVersion < 7)')
  })
})
