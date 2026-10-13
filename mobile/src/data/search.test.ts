import { describe, expect, it } from 'vitest'
import { matchRanges, searchExcerpt } from './search'
import { searchSample } from '../dev/sample'
import { previewBackup, encodeBackup } from './backup'

describe('正文搜索', () => {
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
