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
  }
]

describe('offline document rendering', () => {
  it('renders the same cover and session metadata to text and HTML', () => {
    const text = renderCombinedText(module, sessions, DEFAULT_FILTER_PRESET)
    const html = renderCombinedHtml(module, sessions, DEFAULT_FILTER_PRESET)
    for (const value of ['暗影循迹', '林恩', '第一场', '雨落在窗上。']) {
      expect(text).toContain(value)
      expect(html).toContain(value)
    }
  })

  it('creates a real Office Open XML document without Word', async () => {
    const buffer = await createCombinedDocx(module, sessions, DEFAULT_FILTER_PRESET)
    expect(buffer.subarray(0, 2).toString()).toBe('PK')
    expect(buffer.byteLength).toBeGreaterThan(5_000)
  })
})
