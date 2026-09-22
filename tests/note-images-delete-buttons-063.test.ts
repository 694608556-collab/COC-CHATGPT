import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('0.6.3 note images actually render', () => {
  const sourceHtml = read('src/renderer/index.html')
  const builtHtml = read('out/renderer/index.html')
  const board = read('src/renderer/src/components/NoteBoard.tsx')
  const styles = read('src/renderer/src/styles.css')
  const main = read('src/main/index.ts')

  it('allows the coc-media scheme through the content security policy', () => {
    // 闲记图片走 coc-media:// 自定义协议。0.6.3 之前 CSP 只写了
    // img-src 'self' data:，浏览器直接拦掉，界面只剩一个碎图标加文件名。
    for (const html of [sourceHtml, builtHtml]) {
      const csp = html.slice(html.indexOf('Content-Security-Policy'))
      const imgSrc = csp.slice(csp.indexOf('img-src'), csp.indexOf(';', csp.indexOf('img-src')))
      expect(imgSrc).toContain('coc-media:')
    }
  })

  it('serves the images from the privileged scheme', () => {
    expect(main).toContain("protocol.registerSchemesAsPrivileged")
    expect(main).toContain("scheme: 'coc-media'")
    expect(main).toContain("protocol.handle('coc-media'")
    // 图片 URL 必须和注册的协议一致
    expect(board).toContain('coc-media://')
  })

  it('covers every common image format with the right content type', () => {
    // contentTypeFor 用 extension === '.jpg' 这类判断，png 是最后的默认分支
    const contentTypeFn = main.slice(main.indexOf('function contentTypeFor'))
    for (const [ext, mime] of [
      ['.jpg', 'image/jpeg'],
      ['.jpeg', 'image/jpeg'],
      ['.gif', 'image/gif'],
      ['.webp', 'image/webp'],
      ['.bmp', 'image/bmp']
    ]) {
      expect(contentTypeFn).toContain(`extension === '${ext}'`)
      expect(contentTypeFn).toContain(`return '${mime}'`)
    }
    // png 走兜底返回
    expect(contentTypeFn).toContain("return 'image/png'")
    // 允许保存的扩展名同样要覆盖这些格式
    const noteService = read('src/main/note-file-service.ts')
    for (const ext of ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']) {
      expect(noteService).toContain(`'${ext}'`)
    }
  })

  it('scales inserted images to the card width without distorting them', () => {
    // 编辑区：铺满卡片宽度、高度自适应，不能再用固定方框裁切
    const editorRule = styles.slice(
      styles.indexOf('.note-image-item img {'),
      styles.indexOf('.note-image-item .icon-button')
    )
    expect(editorRule).toContain('width: 100%')
    expect(editorRule).toContain('height: auto')
    expect(editorRule).not.toContain('object-fit: cover')

    // 卡片预览：contain 保持比例，不裁切
    const thumbRule = styles.slice(styles.indexOf('.note-thumbs img {'), styles.indexOf('.note-more'))
    expect(thumbRule).toContain('object-fit: contain')
    expect(thumbRule).not.toContain('object-fit: cover')
  })
})

describe('0.6.3 double-click to view the original image', () => {
  const board = read('src/renderer/src/components/NoteBoard.tsx')
  const styles = read('src/renderer/src/styles.css')

  it('opens the viewer on double-click from both the editor and the card', () => {
    // 两处图片都要能双击放大
    const doubleClicks = board.match(/onDoubleClick=/g) ?? []
    expect(doubleClicks.length).toBeGreaterThanOrEqual(2)
    expect(board).toContain('setZoomed')
    expect(board).toContain('title="双击查看原图"')
  })

  it('does not let the card preview double-click fall through to the edit button', () => {
    // 预览图包在“点开编辑”的按钮里，不阻止冒泡就会一边看图一边进编辑
    const preview = board.slice(board.indexOf('note-thumbs'), board.indexOf('note-more'))
    expect(preview).toContain('event.stopPropagation()')
    expect(preview).toContain('event.preventDefault()')
  })

  it('offers both fit-to-window and 1:1 actual size', () => {
    expect(board).toContain("'适应窗口'")
    expect(board).toContain("'原始尺寸'")
    expect(board).toContain('naturalWidth')
    expect(board).toContain('naturalHeight')
    // 默认适应窗口：等比缩放到窗口内
    const fitRule = styles.slice(
      styles.indexOf('.image-viewer-body img {'),
      styles.indexOf('.image-viewer-body.actual {')
    )
    expect(fitRule).toContain('max-width: 100%')
    expect(fitRule).toContain('max-height: 100%')
    // 原始尺寸：解除限制按 1:1 显示
    const actualRule = styles.slice(styles.indexOf('.image-viewer-body.actual img {'))
    expect(actualRule).toContain('max-width: none')
    expect(actualRule).toContain('max-height: none')
  })

  it('closes on Escape and on backdrop click', () => {
    expect(board).toContain("event.key === 'Escape'")
    expect(board).toContain('document.addEventListener')
    // 点空白处关闭
    const viewer = board.slice(board.indexOf('className="image-viewer"'))
    expect(viewer).toContain('event.target === event.currentTarget')
  })

  it('hints that images are zoomable', () => {
    const hint = styles.slice(styles.indexOf('/* 提示图片可双击放大 */'))
    expect(hint).toContain('cursor: zoom-in')
  })
})

describe('0.6.3 square grey delete buttons in the record summary', () => {
  const app = read('src/renderer/src/App.tsx')
  const styles = read('src/renderer/src/styles.css')
  const board = read('src/renderer/src/components/NoteBoard.tsx')

  it('replaces the module and session delete labels with the shared X icon', () => {
    // 模组删除
    expect(app).toContain('aria-label={`删除模组 ${module.name}`}')
    // 场次删除
    expect(app).toContain('aria-label={`删除场次 ${record.name}`}')
    // 角色卡删除
    expect(app).toContain('aria-label={`删除角色卡 ${character.basic.name')
    // 三处都用同一套 icon-button module-remove + XIcon
    const matches = app.match(/className="icon-button module-remove"/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(3)
  })

  it('keeps the record summary delete buttons square at the old height', () => {
    const rule = styles.slice(
      styles.indexOf('.row-actions .module-remove,'),
      styles.indexOf('.character-card-actions .module-remove {') + 200
    )
    // 高度沿用 30px，宽度取同值 → 正方形
    expect(rule).toContain('width: 30px')
    expect(rule).toContain('height: 30px')
    expect(rule).toContain('min-width: 30px')
    expect(rule).toContain('min-height: 30px')
  })

  it('keeps the grey X glyph identical to the module editor one', () => {
    // 大小形状颜色都复用 .module-remove 的既有定义
    expect(styles).toContain('.module-remove svg { width: 12px; height: 12px; stroke-width: 1.5; }')
    expect(styles).toContain('.module-remove { color: var(--muted);')
  })

  it('leaves the note board delete buttons untouched', () => {
    // 需求只针对“跑团记录汇总”，闲记里的文字删除按钮保持原样
    expect(board).toContain('className="text-button danger"')
    expect(board).toContain('删除')
  })
})
