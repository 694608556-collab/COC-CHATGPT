import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import type { FilterPreset, ModuleRecord, NormalizedLog, SessionRecord } from './types'
import { applyLogFilters } from './log-filter'

export interface RenderableSession {
  record: Pick<SessionRecord, 'name' | 'playDate'>
  log: NormalizedLog
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 运行日志可能来自不同平台：Windows 使用 CRLF，网页抓取与手动记录通常使用 LF。
 * 导出前统一为 LF，随后由各格式按自己的规则写回换行，不能让 CR 字符混入正文。
 */
function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n?/g, '\n')
}

function windowsLineBreaks(value: string): string {
  return normalizeLineBreaks(value).replace(/\n/g, '\r\n')
}

function docxParagraphsForText(value: string): Paragraph[] {
  return normalizeLineBreaks(value).split('\n').map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: line })],
        // 保留原记录的换行节奏，同时避免每一行被 Word 拉得过开。
        spacing: { after: 36 }
      })
  )
}

export function renderLogText(log: NormalizedLog, preset: FilterPreset): string {
  return applyLogFilters(log, preset)
    .map((message) => {
      const body = [message.header, windowsLineBreaks(message.text)].filter(Boolean).join('\r\n')
      const images = message.images.map((image) => `[图片] ${image.url}`).join('\r\n')
      return [body, images].filter(Boolean).join('\r\n')
    })
    .join('\r\n\r\n')
}

export function renderCombinedText(
  module: Pick<ModuleRecord, 'name' | 'kps' | 'pairs'>,
  sessions: RenderableSession[],
  preset: FilterPreset,
  options: { cover?: boolean } = {}
): string {
  const people = [
    `模组：${module.name}`,
    `KP：${module.kps.join('、') || '未填写'}`,
    ...module.pairs.map(
      (pair, index) => `PC${index + 1}：${pair.pc || '未填写'}\u3000PL${index + 1}：${pair.pl || '未填写'}`
    )
  ]
  // 场次连排，不再用分页符；场次之间用明显的分隔线，便于确认场次边界。
  const divider = '\r\n\r\n────────────────────────────────────────\r\n\r\n'
  // 0.6.5：单份导出不再带模组封面，封面只留给合成文件。
  const body = sessions.map(
    ({ record, log }) => `${record.name} · ${record.playDate || '日期未知'}\n\n${renderLogText(log, preset)}`
  )
  return (options.cover === false ? body : [people.join('\n'), ...body]).join(divider)
}

export function renderRawLogJson(log: NormalizedLog): string {
  return JSON.stringify(log, null, 2)
}

export function renderCombinedHtml(
  module: Pick<ModuleRecord, 'name' | 'kps' | 'pairs'>,
  sessions: RenderableSession[],
  preset: FilterPreset,
  options: { cover?: boolean } = {}
): string {
  const participantRows = module.pairs
    .map(
      (pair, index) =>
        `<p>PC${index + 1}：${escapeHtml(pair.pc || '未填写')}\u3000PL${index + 1}：${escapeHtml(pair.pl || '未填写')}</p>`
    )
    .join('')
  const sections = sessions
    .map(({ record, log }) => {
      const messages = applyLogFilters(log, preset)
        .map(
          (message) =>
            `<article><div class="meta">${escapeHtml(message.header)}</div><div class="message">${escapeHtml(normalizeLineBreaks(message.text))}</div>${message.images.map((image) => `<p class="image">[图片] ${escapeHtml(image.url)}</p>`).join('')}</article>`
        )
        .join('')
      return `<section class="session"><h1>${escapeHtml(record.name)} · ${escapeHtml(record.playDate || '日期未知')}</h1>${messages}</section>`
    })
    .join('')
  // 0.6.5：单份导出不再带模组封面，封面只留给合成文件。
  const cover =
    options.cover === false
      ? ''
      : `<section class="cover"><h1>${escapeHtml(module.name)}</h1><p>KP：${escapeHtml(module.kps.join('、') || '未填写')}</p>${participantRows}</section>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font-family:"Microsoft YaHei","Segoe UI",sans-serif;color:#171717;font-size:11pt;line-height:1.65}.cover{page-break-after:always}.session+.session{border-top:2px solid #8a8a8a;margin-top:22px;padding-top:14px}h1{font-size:20pt}.meta{font-weight:700;margin-top:12px}.message{white-space:pre-wrap}.image{color:#666;font-size:9pt}.dark{background:#171a21;color:#eee}</style></head><body class="${preset.darkDisplay ? 'dark' : ''}">${cover}${sections}</body></html>`
}

export function renderWordHtml(
  module: Pick<ModuleRecord, 'name' | 'kps' | 'pairs'>,
  sessions: RenderableSession[],
  preset: FilterPreset,
  includeImages: boolean,
  options: { cover?: boolean } = {}
): string {
  const participantRows = module.pairs
    .map(
      (pair, index) =>
        '<p>PC' +
        (index + 1) +
        ':' +
        escapeHtml(pair.pc || '\u672a\u586b\u5199') +
        ' PL' +
        (index + 1) +
        ':' +
        escapeHtml(pair.pl || '\u672a\u586b\u5199') +
        '</p>'
    )
    .join('')
  const sections = sessions
    .map(({ record, log }) => {
      const messages = applyLogFilters(log, preset)
        .map((message) => {
          const images = includeImages
            ? message.images
                .map(
                  (image) =>
                    '<p class="image">[\u56fe\u7247] ' +
                    escapeHtml(image.url) +
                    '</p><p><img src="' +
                    escapeHtml(image.url) +
                    '" alt="' +
                    escapeHtml(image.alt || '') +
                    '"></p>'
                )
                .join('')
            : ''
          return (
            '<article><div class="meta">' +
            escapeHtml(message.header) +
            '</div><div class="message">' +
            escapeHtml(normalizeLineBreaks(message.text)) +
            '</div>' +
            images +
            '</article>'
          )
        })
        .join('')
      return (
        '<section class="session"><h1>' +
        escapeHtml(record.name) +
        ' - ' +
        escapeHtml(record.playDate || '\u65e5\u671f\u672a\u77e5') +
        '</h1>' +
        messages +
        '</section>'
      )
    })
    .join('')
  // 0.6.5：单份导出不再带模组封面，封面只留给合成文件。
  const cover =
    options.cover === false
      ? ''
      : '<h1>' +
        escapeHtml(module.name) +
        '</h1><p>KP:' +
        escapeHtml(module.kps.join(', ') || '\u672a\u586b\u5199') +
        '</p>' +
        participantRows
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>body{font-family:"Microsoft YaHei","Segoe UI",sans-serif;font-size:11pt;line-height:1.65}' +
    '.meta{font-weight:700;margin-top:12px}.message{white-space:pre-wrap}.image{color:#666;font-size:9pt}img{max-width:100%}</style>' +
    '</head><body>' +
    cover +
    sections +
    '</body></html>'
  )
}

export async function createCombinedDocx(
  module: Pick<ModuleRecord, 'name' | 'kps' | 'pairs'>,
  sessions: RenderableSession[],
  preset: FilterPreset,
  options: { cover?: boolean } = {}
): Promise<Buffer> {
  // 0.6.5：单份导出不再带模组封面，封面只留给合成文件。
  const withCover = options.cover !== false
  const children: Paragraph[] = withCover
    ? [
        new Paragraph({ text: module.name, heading: HeadingLevel.TITLE }),
        new Paragraph({ text: `KP：${module.kps.join('、') || '未填写'}` }),
        ...module.pairs.map(
          (pair, index) =>
            new Paragraph({
              text: `PC${index + 1}：${pair.pc || '未填写'}\u3000PL${index + 1}：${pair.pl || '未填写'}`
            })
        )
      ]
    : []
  for (const [sessionIndex, session] of sessions.entries()) {
    if (sessionIndex === 0) {
      // 有封面时第一场另起一页；没有封面时它就是文档开头，不能再插分页符。
      children.push(
        new Paragraph({
          text: `${session.record.name} · ${session.record.playDate || '日期未知'}`,
          heading: HeadingLevel.HEADING_1,
          ...(withCover ? { pageBreakBefore: true } : {})
        })
      )
    } else {
      children.push(
        new Paragraph({
          border: { bottom: { color: '999999', size: 12, style: 'single', space: 8 } },
          spacing: { before: 240, after: 240 },
          children: []
        })
      )
      children.push(
        new Paragraph({
          text: `${session.record.name} · ${session.record.playDate || '日期未知'}`,
          heading: HeadingLevel.HEADING_1
        })
      )
    }
    for (const message of applyLogFilters(session.log, preset)) {
      children.push(new Paragraph({ children: [new TextRun({ text: message.header, bold: true })] }))
      children.push(...docxParagraphsForText(message.text))
      for (const image of message.images) children.push(new Paragraph({ text: `[图片] ${image.url}` }))
    }
  }
  return Packer.toBuffer(new Document({ sections: [{ children }] }))
}
