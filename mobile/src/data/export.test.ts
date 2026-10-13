import { describe, expect, it } from 'vitest'
import { createExport } from './export'
import { searchSample } from '../dev/sample'
import { unzipSync } from 'fflate'
describe('日志导出', () => {
  it('保留文字、DOC 图片引用和 DOCX 中文内容，缺正文拒绝', async () => {
    const sample = searchSample(),
      module = sample.modules[0]!,
      record = sample.records[0]!
    const txt = await createExport(module, [record], sample.settings.filterPreset, 'txt')
    expect(new TextDecoder().decode(txt.bytes)).toContain('铜钥匙')
    const doc = await createExport(module, [record], sample.settings.filterPreset, 'doc')
    expect(new TextDecoder().decode(doc.bytes)).toContain('&lt;script&gt;不会执行&lt;/script&gt;')
    const docx = await createExport(module, [record], sample.settings.filterPreset, 'docx')
    expect(new TextDecoder().decode(unzipSync(docx.bytes)['word/document.xml'])).toContain('铜钥匙')
    await expect(
      createExport(module, [sample.records[3]!], sample.settings.filterPreset, 'txt')
    ).rejects.toThrow('没有正文')
  })
})
