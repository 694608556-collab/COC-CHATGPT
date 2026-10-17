import { describe, expect, it } from 'vitest'
import { createExport } from './export'
import { searchSample } from '../dev/sample'
import { unzipSync } from 'fflate'
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
describe('日志导出', () => {
  it('DOCX 保留空行、特殊文字、标题、发言人与图片链接的原有 Word 结构', async () => {
    const sample = searchSample(),
      module = sample.modules[0]!,
      record = {
        ...sample.records[0]!,
        name: '中文标题',
        rawContent: {
          parserVersion: 1,
          messages: [
            {
              id: 'public-special',
              order: 0,
              displayName: '主持人',
              text: `首行 <&> "$&" '字符'\r\n\r\n末行😀`,
              type: 'text',
              isDiceCommand: false,
              isOffTopic: false,
              images: [{ url: 'https://example.invalid/public.png' }]
            }
          ]
        }
      }
    const file = await createExport(module, [record], sample.settings.filterPreset, 'docx')
    const expected = await Packer.toArrayBuffer(
      new Document({
        sections: [
          {
            children: [
              new Paragraph({ text: '中文标题', heading: HeadingLevel.HEADING_1, pageBreakBefore: false }),
              new Paragraph({ children: [new TextRun({ text: '主持人', bold: true })] }),
              new Paragraph({ text: `首行 <&> "$&" '字符'` }),
              new Paragraph({ text: '' }),
              new Paragraph({ text: '末行😀' }),
              new Paragraph({ text: '[图片链接] https://example.invalid/public.png' })
            ]
          }
        ]
      })
    )
    expect(unzipSync(file.bytes)['word/document.xml']).toEqual(
      unzipSync(new Uint8Array(expected))['word/document.xml']
    )
  })
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
