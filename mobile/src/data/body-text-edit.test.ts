import { describe, expect, it } from 'vitest'
import { searchSample } from '../dev/sample'
import { editBodyText } from './body-text-edit'

describe('editing a displayed text block', () => {
  it('changes only the requested online message, retaining metadata and other bodies', () => {
    const original = searchSample().records[0]!
    const before = JSON.stringify(original)
    const next = editBodyText(original, 'demo-message-104', '修改\n完整正文')
    expect(next.rawContent!.messages[104]!.text).toBe('修改\n完整正文')
    expect(next.rawContent!.messages[0]).toBe(original.rawContent!.messages[0])
    expect(next.rawContent!.messages[104]).toEqual({
      ...original.rawContent!.messages[104],
      text: '修改\n完整正文'
    })
    expect(next.link).toBe(original.link)
    expect(JSON.stringify(original)).toBe(before)
  })
  it('rejects missing IDs without changing the original', () => {
    const original = searchSample().records[0]!
    expect(() => editBodyText(original, 'missing', '修改')).toThrow('正文已变化')
  })
  it('preserves mixed manual line endings and blank lines', () => {
    const original = {
      ...searchSample().records[1]!,
      rawContent: undefined,
      manualContent: '首行\r\n\r\n目标\n尾行\r'
    }
    expect(editBodyText(original, 'manual-2', '修改\n新增').manualContent).toBe(
      '首行\r\n\r\n修改\n新增\n尾行\r'
    )
  })
  it('permits deleting all text in the selected block', () => {
    const original = searchSample().records[0]!
    expect(editBodyText(original, 'demo-message-0', '').rawContent!.messages[0]!.text).toBe('')
  })
})

describe('speaker editing', () => {
  it('persists speaker and complete body while retaining account, timestamp and raw metadata', () => {
    const record = searchSample().records[0]!
    const original = record.rawContent!.messages[0]!
    original.platformAccount = 'public-account'
    original.raw = { source: 'retained' }
    const body = '完整正文'.repeat(100000) + '\n尾行'
    const next = editBodyText(record, original.id, body, '新说话者')
    expect(next.rawContent!.messages[0]).toEqual({ ...original, displayName: '新说话者', text: body })
    expect(next.rawContent!.messages.slice(1)).toEqual(record.rawContent!.messages.slice(1))
    expect(original.displayName).not.toBe('新说话者')
  })
  it('permits clearing the speaker without changing text', () => {
    const record = searchSample().records[0]!
    const message = record.rawContent!.messages[0]!
    expect(editBodyText(record, message.id, message.text, '').rawContent!.messages[0]!.displayName).toBe('')
  })
  it('adds a speaker to manual text and re-edits it without losing separators or other lines', () => {
    const record = { ...searchSample().records[1]!, rawContent: undefined, manualContent: '首行\r\n\r\n原文\n尾行\r' }
    const next = editBodyText(record, 'manual-2', '修改\n第二行', '林')
    expect(next.manualContent).toBe('首行\r\n\r\n林：修改\n第二行\n尾行\r')
    expect(next.rawContent!.messages[2]).toMatchObject({ displayName: '林', text: '修改\n第二行' })
    const again = editBodyText(next, 'manual-2', '再改正文', '岑')
    expect(again.manualContent).toBe('首行\r\n\r\n岑：再改正文\n尾行\r')
    expect(editBodyText(again, 'manual-2', '', '').manualContent).toBe('首行\r\n\r\n\n尾行\r')
  })
})
