import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createCombinedDocx,
  renderCombinedHtml,
  renderCombinedText,
  renderWordHtml
} from '../src/shared/document-renderer'
import { normalizeSeaResponse } from '../src/shared/sea-log'
import { DEFAULT_FILTER_PRESET } from '../src/shared/types'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

const module = { name: '暗影循迹', kps: ['阿默'], pairs: [{ pc: '林恩', pl: '小夏' }] }
const sessions = [
  {
    record: { name: '第一场', playDate: '2025-03-08' },
    log: normalizeSeaResponse({
      messages: [{ nickname: '阿默', time: '2025-03-08 20:00', content: '雨落在窗上。' }]
    })
  }
]

describe('0.6.5 note image viewer fixes', () => {
  const styles = read('src/renderer/src/styles.css')
  const board = read('src/renderer/src/components/NoteBoard.tsx')

  it('makes the viewer buttons readable in the light theme', () => {
    // 头部整体是白字，而 .secondary 背景取 var(--panel)，浅色模式下正是 #ffffff。
    // 查看器头部必须给按钮一个深色底，否则白字白底看不见。
    const head = styles.slice(styles.indexOf('.image-viewer-head .secondary,'))
    expect(head).toContain('.image-viewer-head .icon-button')
    expect(head).toContain('color: #f2f3f5')
    expect(head).toContain('background: rgba(255, 255, 255, 0.16)')
    // 不能再依赖会被主题改成白色的 var(--panel)
    expect(head.slice(0, 400)).not.toContain('background: var(--panel)')
  })

  it('gives both viewer buttons the same 30px height', () => {
    const rule = styles.slice(
      styles.indexOf('.image-viewer-head .secondary,'),
      styles.indexOf('.image-viewer-head .secondary {')
    )
    expect(rule).toContain('height: 30px')
    expect(rule).toContain('min-height: 30px')
    const closeRule = styles.slice(
      styles.indexOf('.image-viewer-head .icon-button {'),
      styles.indexOf('.image-viewer-head .secondary:hover')
    )
    expect(closeRule).toContain('width: 30px')
  })

  it('stops the titlebar drag region from swallowing clicks on the viewer', () => {
    // 查看器盖住 46px 的标题栏，而标题栏是 app-region: drag（Electron 原生拖拽区），
    // 会把按钮点击当成拖窗口吃掉，导致要点很多次或挪到右上角才生效。
    const viewer = styles.slice(styles.indexOf('.image-viewer {'), styles.indexOf('.image-viewer-head {'))
    expect(viewer).toContain('app-region: no-drag')
    expect(viewer).toContain('-webkit-app-region: no-drag')
    // 标题栏本身仍然要能拖动
    expect(styles).toContain('.titlebar { -webkit-app-region: drag; }')
  })

  it('keeps the toggle button label and both zoom modes', () => {
    expect(board).toContain("'适应窗口'")
    expect(board).toContain("'原始尺寸'")
    expect(board).toContain('naturalWidth')
  })
})

describe('0.6.5 single-record exports drop the module cover', () => {
  it('omits the cover from a single-session text export when asked', () => {
    const withCover = renderCombinedText(module, sessions, DEFAULT_FILTER_PRESET)
    const withoutCover = renderCombinedText(module, sessions, DEFAULT_FILTER_PRESET, { cover: false })
    expect(withCover).toContain('模组：暗影循迹')
    expect(withCover).toContain('KP：阿默')
    expect(withoutCover).not.toContain('模组：暗影循迹')
    expect(withoutCover).not.toContain('KP：阿默')
    expect(withoutCover).not.toContain('林恩')
    // 正文与场次标题照常保留
    expect(withoutCover).toContain('第一场 · 2025-03-08')
    expect(withoutCover).toContain('雨落在窗上。')
  })

  it('omits the cover from the HTML used for single-record PDF', () => {
    const withoutCover = renderCombinedHtml(module, sessions, DEFAULT_FILTER_PRESET, { cover: false })
    expect(withoutCover).not.toContain('class="cover"')
    expect(withoutCover).not.toContain('KP：阿默')
    expect(withoutCover).toContain('第一场 · 2025-03-08')
    expect(withoutCover).toContain('雨落在窗上。')
  })

  it('omits the cover from the Word HTML used for single-record DOC', () => {
    for (const includeImages of [true, false]) {
      const withoutCover = renderWordHtml(module, sessions, DEFAULT_FILTER_PRESET, includeImages, {
        cover: false
      })
      expect(withoutCover).not.toContain('<h1>暗影循迹</h1>')
      expect(withoutCover).not.toContain('KP:阿默')
      expect(withoutCover).not.toContain('林恩')
      expect(withoutCover).toContain('第一场')
      expect(withoutCover).toContain('雨落在窗上。')
    }
  })

  it('drops the cover paragraphs and the leading page break in DOCX', async () => {
    const sourcePath = path.join(root, 'src/shared/document-renderer.ts')
    const source = fs.readFileSync(sourcePath, 'utf8')
    // 无封面时不能再插分页符，否则单份文档会以空白页开头
    expect(source).toContain('...(withCover ? { pageBreakBefore: true } : {})')

    const buffer = await createCombinedDocx(module, sessions, DEFAULT_FILTER_PRESET, { cover: false })
    expect(buffer.subarray(0, 2).toString()).toBe('PK')
    expect(buffer.byteLength).toBeGreaterThan(5_000)
  })

  it('still gives combined exports their cover', () => {
    const text = renderCombinedText(module, sessions, DEFAULT_FILTER_PRESET)
    const html = renderCombinedHtml(module, sessions, DEFAULT_FILTER_PRESET)
    expect(text).toContain('模组：暗影循迹')
    expect(html).toContain('class="cover"')
  })

  it('asks for no cover on every single-record export path', () => {
    const fileService = read('src/main/file-service.ts')
    // 单份导出（exportRecord）用 noCover；合成（exportCombined）保持默认带封面
    expect(fileService).toContain('const noCover = { cover: false }')
    expect(fileService.match(/noCover\)/g)?.length).toBeGreaterThanOrEqual(4)
  })
})
