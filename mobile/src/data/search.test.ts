import { describe, expect, it } from 'vitest'
import { matchRanges, recordMessages, searchExcerpt } from './search'
import { searchSample } from '../dev/sample'
import { previewBackup, encodeBackup } from './backup'

describe('正文搜索', () => {
  it('手动正文跳过空白卡片，保留有效行、原始ID及保存内容', () => {
    const sample = searchSample()
    const record = { ...sample.records[1]!, manualContent: '\r\n  首段  \r\n\t\r\n　\n末段\r尾段\n' }
    const original = record.manualContent
    expect(recordMessages(record, sample.settings.filterPreset)).toEqual([
      { id: 'manual-1', header: '', text: '  首段  ', images: [] },
      { id: 'manual-4', header: '', text: '末段', images: [] },
      { id: 'manual-5', header: '', text: '尾段', images: [] }
    ])
    expect(record.manualContent).toBe(original)
    expect(recordMessages({ ...record, manualContent: '\n \t\r\n　' }, sample.settings.filterPreset)).toEqual(
      []
    )
  })
  it('中文重复命中与空关键词', () => {
    expect(matchRanges('灯塔旁还有灯塔', ' 灯塔 ')).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 7 }
    ])
    expect(matchRanges('灯塔', '  ')).toEqual([])
  })
  it('按字面匹配符号，不执行正则或 HTML', () => {
    for (const text of ['a+b', '[线索]', '.*', '$', '\\', '<script>']) {
      expect(matchRanges('前' + text + '后', text)).toEqual([{ start: 1, end: text.length + 1 }])
    }
    expect(matchRanges('A+b 和 aab', 'a+B')).toEqual([{ start: 0, end: 3 }])
  })
  it('摘要包含远处的关键词并保持原始文本偏移', () => {
    expect(searchExcerpt('甲'.repeat(200) + '铜钥匙' + '乙'.repeat(200), '铜钥匙')).toContain('铜钥匙')
    expect(matchRanges('İ灯塔', '灯塔')).toEqual([{ start: 1, end: 3 }])
  })
  it('公开样本可通过正式导入校验，跨三页包含搜索命中', async () => {
    const sample = searchSample()
    const preview = await previewBackup(encodeBackup(sample))
    expect(preview.snapshot.modules).toHaveLength(2)
    expect(preview.snapshot.records).toHaveLength(4)
    const messages = preview.snapshot.records[0]!.rawContent!.messages
    expect(messages).toHaveLength(240)
    expect(messages.flatMap((m, i) => (m.text.includes('灯塔') ? [i] : []))).toEqual([4, 104, 204])
    expect(preview.offlineRecords).toBe(3)
  })
})
