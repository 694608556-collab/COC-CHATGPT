import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('0.7.0 UI contract', () => {
  const page = read('src/renderer/src/components/ResourcesPage.tsx')
  const viewer = read('src/renderer/src/components/MindmapViewer.tsx')
  const app = read('src/renderer/src/App.tsx')
  const styles = read('src/renderer/src/styles.css')
  const ipc = read('src/main/ipc.ts')
  const api = read('src/shared/api.ts')
  const preload = read('src/preload/index.ts')
  const packagedPreload = read('resources/preload.cjs')
  const confirm = read('src/renderer/src/components/ConfirmDialog.tsx')
  const icons = read('src/renderer/src/components/Icons.tsx')

  it('1. does not repeat the add buttons inside the page', () => {
    // 页头已有 + 导图/+ 链接/+ 文件，页面内不该再有一排
    expect(page).not.toContain('resource-toolbar')
    expect(styles).not.toContain('.resource-toolbar')
    // 页头的三个按钮保留
    expect(app).toContain("setResourceCreating('mindmap')")
    expect(app).toContain("setResourceCreating('link')")
    expect(app).toContain("setResourceCreating('file')")
  })

  it('2c/2d. supports wheel zoom and drag panning', () => {
    expect(viewer).toContain('onWheel')
    expect(viewer).toContain('onMouseDown')
    expect(viewer).toContain('onMouseMove')
    expect(viewer).toContain('scrollLeft')
    expect(viewer).toContain('scrollTop')
    // 拖拽时给出抓手光标
    expect(styles).toContain('.mindmap-viewer-body.panning')
    expect(styles).toContain('cursor: grabbing')
  })

  it('2e. keeps the close button the same style as the toolbar buttons', () => {
    // 关闭键不再用 .module-remove（那是浅色主题的灰色小方块），
    // 改成和工具条按钮同一套深色外观，尺寸也统一
    expect(viewer).toContain('icon-button mindmap-close')
    expect(viewer).not.toContain('module-remove" aria-label="关闭预览"')
    const rule = styles.slice(styles.indexOf('.mindmap-close {'), styles.indexOf('.mindmap-close:hover'))
    expect(rule).toContain('background: color-mix(in srgb, #fff 18%')
    expect(rule).toContain('height: 30px')
  })

  it('2f. renames the outline tab', () => {
    expect(viewer).toContain('大纲显示')
    expect(viewer).not.toContain('大纲 {data.outline.length}')
  })

  it('2g. searches node text inside the current map', () => {
    expect(viewer).toContain('节点内容搜索框')
    expect(viewer).toContain('mindmap-hits')
    // 0.7.1 起搜索直接读画布 SVG：要高亮就必须知道「第几段、第几个字」，
    // 光有一串文字（page.texts）算不出位置。仍保留 texts 供统计与其它用途。
    expect(viewer).toContain('extractSvgTextRuns')
    expect(viewer).toContain('findSvgMatches')
    expect(ipc).toContain('texts: page.texts')
    // emmx 的搜索也要覆盖关系连线标签与分组框标题
    expect(ipc).toContain('...page.labels.flatMap((label) => label.lines)')
  })

  it('3. drops the per-card owner dropdown and adds drag and drop', () => {
    // 卡片底部的归属下拉已删除
    expect(page).not.toContain('resource-tile-owner')
    expect(styles).not.toContain('.resource-tile-owner')
    // 新建时仍然要选归属
    expect(page).toContain('归属模组')
    expect(page).toContain('不归属任何模组')
    // 拖拽改归属与排序
    expect(page).toContain('draggable')
    expect(page).toContain('onDragStart')
    expect(page).toContain('onDrop')
    expect(page).toContain('dropInto')
    expect(styles).toContain('.resource-group.drop-target')
  })

  it('3b. deleting a group offers both choices', () => {
    expect(page).toContain('删除分组')
    // 两个选项：只清空资料 / 连分组一起删
    expect(page).toContain('只清空资料')
    expect(page).toContain('连分组一起删')
    // 两个动作都是对话框里的正规按钮
    expect(confirm).toContain('secondaryAction')
    expect(confirm).toContain('options.secondaryAction.label')
  })

  it('supplement 2. adds an update button left of the folder button', () => {
    expect(page).toContain('RefreshIcon')
    expect(icons).toContain('export function RefreshIcon')
    expect(page).toContain('chooseReplacement')
    expect(page).toContain('relink')
    // 顺序：更新 → 打开 → 移除
    const actions = page.slice(page.indexOf('resource-tile-actions'), page.indexOf('resource-tile-actions') + 1400)
    expect(actions.indexOf('RefreshIcon')).toBeLessThan(actions.indexOf('<FolderIcon'))
    expect(actions.indexOf('<FolderIcon')).toBeLessThan(actions.indexOf('<XIcon'))
  })

  it('5. loads image thumbnails through the new channel', () => {
    expect(ipc).toContain("'resources:read-image'")
    expect(page).toContain('window.coc.resources.readImage')
    expect(styles).toContain('.resource-tile-image')
  })

  it('6. uses an svg link glyph instead of an emoji', () => {
    expect(page).toContain('LinkGlyph')
    expect(page).not.toContain("'🔗'")
    expect(styles).toContain('.resource-tile-link')
  })

  it('7. removes the black browser tooltip', () => {
    // 不再用 title 提示「用原程序打开（编辑仍在原软件里进行）」
    expect(page).not.toContain('用原程序打开（编辑仍在原软件里进行）')
    expect(page).toContain('title="用原程序打开"')
  })

  it('8. supports html exports with sub-page switching at the bottom', () => {
    expect(ipc).toContain('parseMindmapHtml')
    expect(ipc).toContain("extension === '.html'")
    // 子页面按钮放底部
    expect(viewer).toContain('mindmap-pages')
    expect(viewer.indexOf('mindmap-viewer-body')).toBeLessThan(viewer.indexOf('mindmap-pages'))
    // 切页时缩放复位
    expect(viewer).toContain('setZoom(1)')
    // 文件选择框要能选 html
    expect(ipc).toContain("extensions: ['html', 'htm', 'emmx', 'emmxz']")
  })

  it('8b. explains the new emmx format instead of failing silently', () => {
    // EdrawMind 12.x 的私有格式读不出图形，必须告诉用户导出 HTML
    expect(page).toContain('formatNotice')
    expect(page).toContain('这个导图需要先导出为 HTML')
    expect(page).toContain('现在打开 EdrawMind')
    // 选完文件就检查，不用等双击预览才发现
    expect(page).toContain('await window.coc.resources.readMindmap(first.path)')
    // 用对话框而不是一闪而过的通知
    expect(page).toContain('DialogShell')
  })

  it('keeps both preloads in sync for the new channels', () => {
    for (const source of [preload, packagedPreload]) {
      expect(source).toContain('readImage:')
      expect(source).toContain('chooseReplacement:')
      expect(source).toContain('relink:')
    }
    expect(api).toContain('readImage(targetPath: string): Promise<string>')
    expect(api).toContain("format: 'html' | 'emmx'")
  })

  it('2b. keeps the canvas below the chrome so borders do not bleed through', () => {
    const rule = styles.slice(styles.indexOf('.mindmap-canvas {'), styles.indexOf('.mindmap-canvas svg'))
    expect(rule).toContain('position: relative')
    expect(rule).toContain('z-index: 0')
    // SVG 不吃鼠标事件，拖拽平移才不会被图形挡住
    expect(styles).toContain('pointer-events: none')
  })
})
