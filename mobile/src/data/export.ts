import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import { jsPDF } from 'jspdf'
import { renderLogText, renderWordHtml } from '../../../src/shared/document-renderer'
import { applyLogFilters } from '../../../src/shared/log-filter'
import type { FilterPreset, SessionRecord, ModuleRecord, NormalizedLog } from '../../../src/shared/types'
import { waitForAppFonts } from './fonts'
export type ExportFormat = 'raw' | 'txt' | 'doc' | 'dialogue-doc' | 'docx' | 'pdf'
export const EXPORT_LABELS: Record<ExportFormat, string> = {
  raw: '原始 JSON',
  txt: 'TXT',
  doc: '带图 DOC',
  'dialogue-doc': '纯对话 DOC',
  docx: 'DOCX',
  pdf: 'PDF'
}
export function safeName(value: string) {
  return (
    Array.from(value)
      .map((c) => (c.charCodeAt(0) < 32 ? '_' : c))
      .join('')
      .replace(/[\\/:*?"<>|.]/g, '_')
      .slice(0, 60) || '场次'
  )
}
export function asLog(record: SessionRecord): NormalizedLog {
  if (record.rawContent) return record.rawContent
  if (record.manualContent === undefined) throw new Error('此场次没有正文，无法导出：' + record.name)
  return {
    parserVersion: 1,
    messages: [
      {
        id: 'manual',
        order: 0,
        displayName: '',
        text: record.manualContent,
        type: 'text',
        isDiceCommand: false,
        isOffTopic: false,
        images: []
      }
    ]
  }
}
export async function createExport(
  module: ModuleRecord,
  records: SessionRecord[],
  filters: FilterPreset,
  format: ExportFormat,
  combined = false
) {
  filters = { ...filters, indentFirstLine: false, darkDisplay: false }
  if (!records.length) throw new Error('没有选中场次。')
  const sessions = records.map((record) => ({ record, log: asLog(record) }))
  const name = safeName(combined ? module.name + '-合成' : records[0]!.name)
  if (format === 'raw')
    return {
      name: name + '.json',
      mime: 'application/json',
      bytes: new TextEncoder().encode(
        JSON.stringify(
          combined ? sessions.map((s) => ({ record: s.record, log: s.log })) : sessions[0]!.log,
          null,
          2
        )
      )
    }
  const header = combined
    ? module.name +
      '\r\nKP：' +
      module.kps.join('、') +
      '\r\n' +
      module.pairs.map((p) => 'PC：' + p.pc + ' PL：' + p.pl).join('\r\n') +
      '\r\n\r\n'
    : ''
  const text =
    header +
    sessions
      .map(
        (s) =>
          (combined ? s.record.name + ' · ' + (s.record.playDate || '') + '\r\n\r\n' : '') +
          (s.record.rawContent ? renderLogText(s.log, filters) : s.record.manualContent)
      )
      .join('\r\n\r\n')
  if (format === 'txt')
    return { name: name + '.txt', mime: 'text/plain', bytes: new TextEncoder().encode(text) }
  if (format === 'doc' || format === 'dialogue-doc')
    return {
      name: name + '.doc',
      mime: 'application/msword',
      bytes: new TextEncoder().encode(
        renderWordHtml(module, sessions, filters, format === 'doc', { cover: combined })
      )
    }
  if (format === 'docx') {
    const children: Paragraph[] = []
    if (combined) {
      children.push(
        new Paragraph({ text: module.name, heading: HeadingLevel.TITLE }),
        new Paragraph({ text: 'KP：' + module.kps.join('、') })
      )
      module.pairs.forEach((p) => children.push(new Paragraph({ text: 'PC：' + p.pc + ' PL：' + p.pl })))
    }
    sessions.forEach((s, i) => {
      children.push(
        new Paragraph({
          text: s.record.name,
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: combined && i === 0
        })
      )
      applyLogFilters(s.log, filters).forEach((m) => {
        if (m.header)
          children.push(new Paragraph({ children: [new TextRun({ text: m.header, bold: true })] }))
        m.text
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .forEach((line) => children.push(new Paragraph({ text: line })))
        m.images.forEach((image) => children.push(new Paragraph({ text: '[图片链接] ' + image.url })))
      })
    })
    const blob = await Packer.toBlob(new Document({ sections: [{ children }] }))
    return {
      name: name + '.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: new Uint8Array(await blob.arrayBuffer())
    }
  }
  return { name: name + '.pdf', mime: 'application/pdf', bytes: await textPdf(text) }
}

/** Raster pages use the same embedded font faces as the app, without depending on system font settings. */
export async function textPdf(text: string): Promise<Uint8Array> {
  await waitForAppFonts()
  const canvas = document.createElement('canvas')
  canvas.width = 1240
  canvas.height = 1754
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('此设备无法生成 PDF。')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  let y = 86,
    pages = 0
  function blank() {
    ctx!.fillStyle = '#fff'
    ctx!.fillRect(0, 0, 1240, 1754)
    ctx!.fillStyle = '#171717'
    ctx!.font = '24px "SF Pro Text", "PingFang SC"'
    y = 86
  }
  function flush() {
    if (++pages > 150) throw new Error('PDF 超过 150 页，请分批导出。')
    ctx!.font = '18px "SF Pro Text", "PingFang SC"'
    ctx!.fillText(String(pages), 600, 1710)
    ctx!.font = '24px "SF Pro Text", "PingFang SC"'
    if (pages > 1) pdf.addPage()
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 595.28, 841.89)
    blank()
  }
  function line(value: string) {
    if (y > 1650) flush()
    ctx!.fillText(value, 86, y)
    y += 38
  }
  blank()
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let value = ''
    for (const ch of paragraph) {
      if (ctx.measureText(value + ch).width > 1068) {
        line(value)
        value = ch
      } else value += ch
    }
    line(value)
  }
  flush()
  return new Uint8Array(pdf.output('arraybuffer'))
}
