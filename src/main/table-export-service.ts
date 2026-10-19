import { ZipArchive } from 'archiver'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { AppError } from '../shared/errors'
import { exportRecordTables } from '../shared/record-table'
import type { ArchiveEntry } from '../shared/types'
import { sanitizeWindowsName } from '../shared/safe-path'
import { ArchivePathService } from './archive-path'
import type { AppRepository } from './repository'

export type TableExportFormat = 'csv' | 'xlsx'

export class TableExportService {
  /** 同一服务的导出依次选名和登记，避免异步ZIP任务复用临时路径。 */
  private exportQueue: Promise<void> = Promise.resolve()

  constructor(private readonly repository: AppRepository) {}

  /**
   * 串行导出并登记场次表格，上一任务失败不阻塞后续任务。
   * @param format 导出格式。
   * @param selectedRecordIds 限定场次；未传时导出全部。
   * @returns 文件和归档登记均成功后的归档条目。
   */
  export(format: TableExportFormat, selectedRecordIds?: string[]): Promise<ArchiveEntry> {
    const task = this.exportQueue.then(() => this.writeExport(format, selectedRecordIds))
    this.exportQueue = task.then(
      () => undefined,
      () => undefined
    )
    return task
  }

  /** @param format 导出格式。@param selectedRecordIds 所选场次。@returns 已写入并登记的条目。 */
  private async writeExport(format: TableExportFormat, selectedRecordIds?: string[]): Promise<ArchiveEntry> {
    const snapshot = this.repository.snapshot()
    const files = exportRecordTables(snapshot, format, selectedRecordIds)
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const extension = format === 'csv' && files.length > 1 ? 'zip' : format
    const destination = new ArchivePathService(
      () => this.repository.getSettings().archiveDirectory
    ).availableRootFile(
      `COC跑团记录${date}.${extension}`,
      snapshot.archiveEntries.map((entry) => entry.path)
    )
    const temporary = `${destination}.${process.pid}.tmp`
    try {
      if (extension === 'zip') await this.writeZip(temporary, files)
      else fs.writeFileSync(temporary, files[0]!.bytes)
      const stat = fs.statSync(temporary)
      if (!stat.size) throw new Error('生成的表格文件为空')
      fs.renameSync(temporary, destination)
      const bytes = fs.readFileSync(destination)
      return this.repository.addArchiveEntry({
        ownerType: 'backup',
        ownerId: 'record-table',
        path: destination,
        format: extension,
        size: bytes.byteLength,
        hash: createHash('sha256').update(bytes).digest('hex'),
        exists: true
      })
    } catch (error) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
      throw new AppError('TABLE_EXPORT_FAILED', 'CONVERSION', '表格导出失败，请检查归档目录。', true, error)
    }
  }

  private writeZip(destination: string, files: Array<{ name: string; bytes: Uint8Array }>): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(destination)
      const archive = new ZipArchive({ zlib: { level: 9 } })
      output.once('close', resolve)
      output.once('error', reject)
      archive.once('error', reject)
      archive.pipe(output)
      for (const file of files) {
        const stem = file.name.toLocaleLowerCase().endsWith('.csv') ? file.name.slice(0, -4) : file.name
        archive.append(Buffer.from(file.bytes), {
          name: `${sanitizeWindowsName(stem, '未命名模组')}.csv`
        })
      }
      void archive.finalize()
    })
  }
}
