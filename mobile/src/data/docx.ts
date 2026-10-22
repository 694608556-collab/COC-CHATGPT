import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { applyLogFilters } from '../../../src/shared/log-filter'
import type { ModuleRecord, SessionRecord, NormalizedLog, FilterPreset } from '../../../src/shared/types'

/** 由现有 DOCX 库生成的五种段落模板，不手写样式、关系或 Word 文档默认设置。 */
interface DocxTemplate {
  /** 原库生成的完整 ZIP 部件，当前文件仅替换正文 XML。 */
  parts: Record<string, Uint8Array>
  /** body 中五个示例段落之前的 XML。 */
  prefix: string
  /** 最后示例段落之后的节属性和文档结尾。 */
  suffix: string
  /** 五个段落分别为普通行、发言人、模组封面标题、场次标题、首页场次标题。 */
  paragraphs: string[]
  /** 同五种样式的空段落，保留原库无文字时的结构。 */
  empty: string[]
}
const marker = 'COC_EXPORT_TEMPLATE_TEXT_'
let template: Promise<DocxTemplate> | undefined

/** @returns 当前库生成的一份可复用格式模板；初始化失败不缓存失败结果。 */
async function loadTemplate(): Promise<DocxTemplate> {
  if (!template) {
    template = (async () => {
      const children = [
        new Paragraph({ text: marker + '0' }),
        new Paragraph({ children: [new TextRun({ text: marker + '1', bold: true })] }),
        new Paragraph({ text: marker + '2', heading: HeadingLevel.TITLE }),
        new Paragraph({ text: marker + '3', heading: HeadingLevel.HEADING_1, pageBreakBefore: false }),
        new Paragraph({ text: marker + '4', heading: HeadingLevel.HEADING_1, pageBreakBefore: true }),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: '', bold: true })] }),
        new Paragraph({ text: '', heading: HeadingLevel.TITLE }),
        new Paragraph({ text: '', heading: HeadingLevel.HEADING_1, pageBreakBefore: false }),
        new Paragraph({ text: '', heading: HeadingLevel.HEADING_1, pageBreakBefore: true })
      ]
      const parts = unzipSync(
        new Uint8Array(await Packer.toArrayBuffer(new Document({ sections: [{ children }] })))
      )
      const xml = strFromU8(parts['word/document.xml']!)
      const paragraphs: RegExpExecArray[] = []
      const paragraphPattern = /<w:p(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/w:p>)/g
      let paragraph: RegExpExecArray | null
      while ((paragraph = paragraphPattern.exec(xml)) !== null) paragraphs.push(paragraph)
      if (paragraphs.length !== 10 || paragraphs.slice(0, 5).some((p, i) => !p[0].includes(marker + i)))
        throw new Error('DOCX 格式模板不兼容，未保存文件。')
      return {
        parts,
        prefix: xml.slice(0, paragraphs[0]!.index),
        suffix: xml.slice(paragraphs[9]!.index! + paragraphs[9]![0].length),
        paragraphs: paragraphs.slice(0, 5).map((p) => p[0]),
        empty: paragraphs.slice(5).map((p) => p[0])
      }
    })().catch((error) => {
      template = undefined
      throw error
    })
  }
  return template
}

/** @param value - 原始文字，包含全部换行分拆后的行内容。 @returns XML 文字节点编码；不删改正文。 */
function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 用原库的段落与文件模板生成 DOCX，避免每条消息重复构建对象树和通用 XML 编译器。
 * @param module - 模组名称与参与者，仅合成时增加原有封面字段。
 * @param sessions - 有序、完整正文及场次信息。
 * @param filters - 原导出过滤规则。
 * @param combined - 是否保留原有合成封面和首页分页。
 * @returns 完整 DOCX ZIP 字节；不读取网络或创建归档，调用方在 Worker 执行大任务。
 */
export async function createTextDocx(
  module: ModuleRecord,
  sessions: Array<{ record: SessionRecord; log: NormalizedLog }>,
  filters: FilterPreset,
  combined: boolean
): Promise<Uint8Array> {
  const base = await loadTemplate()
  const paragraphs: string[] = []
  /** @param kind - 原库的段落类型。 @param text - 完整文字。 @returns 无返回值，将编码后的段落加入本文件。 */
  function add(kind: number, text: string): void {
    // replace 回调避免正文中的 $& / $' 等符号被解释为替换语法。
    paragraphs.push(
      text ? base.paragraphs[kind]!.replace(marker + kind, () => escapeText(text)) : base.empty[kind]!
    )
  }
  if (combined) {
    add(2, module.name)
    add(0, 'KP：' + module.kps.join('、'))
    for (const pair of module.pairs) add(0, 'PC：' + pair.pc + ' PL：' + pair.pl)
  }
  for (const [index, session] of sessions.entries()) {
    add(combined && index === 0 ? 4 : 3, session.record.name)
    for (const message of applyLogFilters(session.log, filters)) {
      if (message.header) add(1, message.header)
      for (const line of message.text.replace(/\r\n?/g, '\n').split('\n')) add(0, line)
      for (const image of message.images) add(0, '[图片链接] ' + image.url)
    }
  }
  return zipSync(
    { ...base.parts, 'word/document.xml': strToU8(base.prefix + paragraphs.join('') + base.suffix) },
    { level: 6 }
  )
}
