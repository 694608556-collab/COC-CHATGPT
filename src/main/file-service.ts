import { createHash } from 'node:crypto'
import fs from 'node:fs'
import {
  createCombinedDocx,
  renderCombinedHtml,
  renderCombinedText,
  renderLogText,
  renderRawLogJson,
  renderWordHtml
} from '../shared/document-renderer'
import { AppError } from '../shared/errors'
import type { ArchiveEntry, NormalizedLog, SessionRecord } from '../shared/types'
import { ArchivePathService } from './archive-path'
import { JobManager, type JobSnapshot } from './job-manager'
import type { AppRepository } from './repository'

export type RecordExportFormat = 'raw' | 'doc' | 'dialogue-doc' | 'docx' | 'txt' | 'pdf'
export type CombinedExportFormat = 'txt' | 'docx' | 'pdf'
export type LocalExportFormat = RecordExportFormat
export type PdfPrinter = (html: string) => Promise<Buffer>

export interface CombinedExportResult {
  entry: ArchiveEntry
  included: string[]
  failed: Array<{ id: string; reason: string }>
}

function extensionFor(format: RecordExportFormat | CombinedExportFormat): string {
  if (format === 'raw') return 'json'
  if (format === 'dialogue-doc') return 'doc'
  return format
}

function recordNameSuffix(format: RecordExportFormat): string {
  if (format === 'doc') return '\u5e26\u56fe'
  if (format === 'dialogue-doc') return '\u5bf9\u8bdd'
  if (format === 'raw') return '\u539f\u59cb'
  return ''
}

function manualLog(record: SessionRecord): NormalizedLog {
  return {
    parserVersion: 1,
    messages: [
      {
        id: `${record.id}-manual`,
        order: 0,
        displayName: '手动记录',
        text: record.manualContent ?? '',
        type: 'text',
        isDiceCommand: false,
        isOffTopic: false,
        images: []
      }
    ]
  }
}

export class FileService {
  constructor(
    private readonly repository: AppRepository,
    private readonly pdfPrinter: PdfPrinter,
    private readonly jobs = new JobManager()
  ) {}

  async exportRecord(recordId: string, format: LocalExportFormat): Promise<ArchiveEntry> {
    const record = this.repository.findRecord(recordId)
    const module = this.repository.findModule(record.moduleId)
    const log = this.exportableLog(record)
    const settings = this.repository.getSettings()
    const pathService = new ArchivePathService(() => settings.archiveDirectory)
    const date = record.playDate?.replace(/-/g, '') || '日期未知'
    const destination = pathService.availableFile(
      module.name,
      `${date}${module.name}${record.name}${recordNameSuffix(format)}.${extensionFor(format)}`
    )
    const temporary = `${destination}.${process.pid}.tmp`
    try {
      const session = [{ record, log }]
      // 0.6.5：单份导出一律不带模组封面（模组名 + KP + PC/PL），封面只留给合成文件。
      const noCover = { cover: false }
      if (format === 'raw') fs.writeFileSync(temporary, renderRawLogJson(log), 'utf8')
      else if (format === 'txt')
        fs.writeFileSync(temporary, renderLogText(log, settings.filterPreset), 'utf8')
      else if (format === 'doc')
        fs.writeFileSync(
          temporary,
          renderWordHtml(module, session, settings.filterPreset, true, noCover),
          'utf8'
        )
      else if (format === 'dialogue-doc')
        fs.writeFileSync(
          temporary,
          renderWordHtml(module, session, settings.filterPreset, false, noCover),
          'utf8'
        )
      else if (format === 'docx')
        fs.writeFileSync(
          temporary,
          await createCombinedDocx(module, session, settings.filterPreset, noCover)
        )
      else {
        const pdf = await this.pdfPrinter(
          renderCombinedHtml(module, session, settings.filterPreset, noCover)
        )
        if (pdf.subarray(0, 4).toString() !== '%PDF') throw new Error('PDF 文件头无效')
        fs.writeFileSync(temporary, pdf)
      }
      return this.finishAndRegister(temporary, destination, 'record', record.id, format)
    } catch (error) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
      // 归档目录本身的错误已经写清楚了原因，原样抛出，别再包一层
      if (error instanceof AppError && error.code.startsWith('ARCHIVE_DIRECTORY')) throw error
      if (error instanceof AppError) throw error
      throw new AppError('EXPORT_FAILED', 'CONVERSION', '文件生成失败，请检查归档目录是否可写。', true, error)
    }
  }

  async batchExport(recordIds: string[], format: LocalExportFormat): Promise<JobSnapshot<ArchiveEntry>> {
    return this.jobs.run('batch-export', recordIds, (recordId) => this.exportRecord(recordId, format))
  }

  async exportCombined(recordIds: string[], format: CombinedExportFormat): Promise<CombinedExportResult> {
    const selected = new Set(recordIds)
    const records = this.repository.snapshot().records.filter((record) => selected.has(record.id))
    if (!records.length) throw new AppError('COMBINE_EMPTY', 'VALIDATION', '请先选择需要合成的场次。')
    const moduleIds = new Set(records.map((record) => record.moduleId))
    if (moduleIds.size !== 1) {
      throw new AppError('COMBINE_MULTIPLE_MODULES', 'VALIDATION', '批量合成只允许选择同一个模组内的场次。')
    }
    const module = this.repository.findModule(records[0]!.moduleId)
    const included: Array<{ record: SessionRecord; log: NormalizedLog }> = []
    const failed: Array<{ id: string; reason: string }> = []
    for (const record of records) {
      try {
        included.push({ record, log: this.exportableLog(record) })
      } catch (error) {
        failed.push({ id: record.id, reason: error instanceof Error ? error.message : '正文不可用' })
      }
    }
    if (!included.length)
      throw new AppError('COMBINE_NO_CONTENT', 'CONVERSION', '所选场次均无可用正文，未生成合集。')
    const settings = this.repository.getSettings()
    const generatedDate = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const destination = new ArchivePathService(() => settings.archiveDirectory).batchFile(
      module.name,
      `${generatedDate}${module.name}合集.${format}`
    )
    const temporary = `${destination}.${process.pid}.tmp`
    try {
      if (format === 'txt')
        fs.writeFileSync(temporary, renderCombinedText(module, included, settings.filterPreset), 'utf8')
      else if (format === 'docx')
        fs.writeFileSync(temporary, await createCombinedDocx(module, included, settings.filterPreset))
      else {
        const pdf = await this.pdfPrinter(renderCombinedHtml(module, included, settings.filterPreset))
        if (pdf.subarray(0, 4).toString() !== '%PDF') throw new Error('PDF 文件头无效')
        fs.writeFileSync(temporary, pdf)
      }
      const entry = this.finishAndRegister(temporary, destination, 'module', module.id, format)
      return { entry, included: included.map((item) => item.record.id), failed }
    } catch (error) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
      // 归档目录本身的错误已经写清楚了原因，原样抛出，别再包一层
      if (error instanceof AppError && error.code.startsWith('ARCHIVE_DIRECTORY')) throw error
      throw new AppError('COMBINE_FAILED', 'CONVERSION', '合集生成失败，请检查归档目录。', true, error)
    }
  }

  moduleDirectory(moduleId: string): string {
    const module = this.repository.findModule(moduleId)
    return new ArchivePathService(() => this.repository.getSettings().archiveDirectory).moduleDirectory(
      module.name
    )
  }

  activeJobs(): ReturnType<JobManager['active']> {
    return this.jobs.active()
  }

  private exportableLog(record: SessionRecord): NormalizedLog {
    const log = record.manualContent ? manualLog(record) : record.rawContent
    if (!log) throw new AppError('EXPORT_CONTENT_MISSING', 'CONVERSION', '尚无可导出的正文，请先检测链接。')
    if (!record.manualContent && record.link !== record.cacheSourceUrl) {
      throw new AppError('EXPORT_CACHE_STALE', 'CONVERSION', '链接已经修改，请重新检测后再导出。')
    }
    return log
  }

  private finishAndRegister(
    temporary: string,
    destination: string,
    ownerType: ArchiveEntry['ownerType'],
    ownerId: string,
    format: string
  ): ArchiveEntry {
    const temporaryStat = fs.statSync(temporary)
    if (!temporaryStat.size) throw new Error('生成的文件为空')
    fs.renameSync(temporary, destination)
    const bytes = fs.readFileSync(destination)
    return this.repository.addArchiveEntry({
      ownerType,
      ownerId,
      path: destination,
      format,
      size: bytes.byteLength,
      hash: createHash('sha256').update(bytes).digest('hex'),
      exists: true
    })
  }
}
