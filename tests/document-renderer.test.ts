import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import unzipper from 'unzipper'
import { describe, expect, it } from 'vitest'
import { createCombinedDocx, renderCombinedHtml, renderCombinedText } from '../src/shared/document-renderer'
import { normalizeSeaResponse } from '../src/shared/sea-log'
import { DEFAULT_FILTER_PRESET } from '../src/shared/types'

const module = { name: '暗影循迹', kps: ['阿默'], pairs: [{ pc: '林恩', pl: '小夏' }] }
const sessions = [
  {
    record: { name: '第一场', playDate: '2025-03-08' },
    log: normalizeSeaResponse({
      messages: [{ nickname: '阿默', time: '2025-03-08 20:00', content: '雨落在窗上。' }]
    })
  },
  {
    record: { name: '第二场', playDate: '2025-03-15' },
    log: normalizeSeaResponse({
      messages: [{ nickname: '阿默', time: '2025-03-15 20:00', content: '灯芯亮了。' }]
    })
  }
]

describe('offline document rendering', () => {
  it('renders the same cover and session metadata to text and HTML', () => {
    const text = renderCombinedText(module, sessions, DEFAULT_FILTER_PRESET)
    const html = renderCombinedHtml(module, sessions, DEFAULT_FILTER_PRESET)
    for (const value of ['暗影循迹', '林恩', '第一场', '第二场', '雨落在窗上。', '灯芯亮了。']) {
      expect(text).toContain(value)
      expect(html).toContain(value)
    }
  })

  it('keeps sessions flowing with divider lines instead of per-session page breaks', () => {
    const text = renderCombinedText(module, sessions, DEFAULT_FILTER_PRESET)
    const html = renderCombinedHtml(module, sessions, DEFAULT_FILTER_PRESET)
    expect(text).not.toContain('\f')
    expect(text).toContain('────────')
    expect(html).not.toContain('page-break-before:always')
    expect(html).toContain('.session+.session')
    expect(html).toContain('border-top')
    // 封面仍然单独占第一页
    expect(html).toContain('.cover{page-break-after:always}')
  })

  it('creates a real Office Open XML document without Word', async () => {
    const buffer = await createCombinedDocx(module, sessions, DEFAULT_FILTER_PRESET)
    expect(buffer.subarray(0, 2).toString()).toBe('PK')
    expect(buffer.byteLength).toBeGreaterThan(5_000)
  })

  it('preserves Windows and Unix line breaks in TXT, HTML/PDF, and DOCX exports', async () => {
    const lineBreakSessions = [
      {
        record: { name: '换行场次', playDate: '2025-03-22' },
        log: normalizeSeaResponse({
          messages: [
            {
              nickname: 'KP',
              time: '2025-03-22 20:00',
              content: '第一行\r\n第二行\n\n第四行'
            }
          ]
        })
      }
    ]
    const text = renderCombinedText(module, lineBreakSessions, DEFAULT_FILTER_PRESET, { cover: false })
    const html = renderCombinedHtml(module, lineBreakSessions, DEFAULT_FILTER_PRESET, { cover: false })
    const docx = await createCombinedDocx(module, lineBreakSessions, DEFAULT_FILTER_PRESET, {
      cover: false
    })

    expect(text).toContain('第一行\r\n第二行\r\n\r\n第四行')
    expect(html).toContain('.message{white-space:pre-wrap}')
    expect(html).toContain('第一行\n第二行\n\n第四行')
    expect(html).not.toContain('\r')

    // DOCX 中每个原始换行都有独立的 Word 段落；空行也不能被合并掉。
    const archive = await unzipper.Open.buffer(docx)
    const documentXml = await archive.files.find((file) => file.path === 'word/document.xml')?.buffer()
    expect(documentXml).toBeDefined()
    const xml = documentXml!.toString('utf8')
    expect(xml).toContain('第一行')
    expect(xml).toContain('第二行')
    expect(xml).toContain('第四行')
    expect(xml.match(/<w:p(?:\s|>)/g)?.length).toBeGreaterThanOrEqual(6)
    expect(docx.byteLength).toBeGreaterThan(5_000)
  })

  it('breaks the page only once after the cover in the DOCX source', () => {
    const sourcePath = fileURLToPath(new URL('../src/shared/document-renderer.ts', import.meta.url))
    const source = readFileSync(sourcePath, 'utf8')
    expect(source.match(/pageBreakBefore:\s*true/g)).toHaveLength(1)
    expect(source).toContain("border: { bottom: { color: '999999'")
    expect(source).not.toContain("'\\f'")
  })
})
