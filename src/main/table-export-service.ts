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
  constructor(private readonly repository: AppRepository) {}

  async export(format: TableExportFormat, selectedRecordIds?: string[]): Promise<ArchiveEntry> {
    const files = exportRecordTables(this.repository.snapshot(), format, selectedRecordIds)
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const extension = format === 'csv' && files.length > 1 ? 'zip' : format
    const destination = new ArchivePathService(
      () => this.repository.getSettings().archiveDirectory
    ).availableRootFile(`COC跑团记录${date}.${extension}`)
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
