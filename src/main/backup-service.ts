import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ZipArchive } from 'archiver'
import * as unzipper from 'unzipper'
import { AppError } from '../shared/errors'
import { isPathInside, nextAvailableName, sanitizeWindowsName } from '../shared/safe-path'
import type { AppSnapshot, ArchiveEntry, NoteRecord } from '../shared/types'
import type { AppRepository } from './repository'

export interface BackupManifestEntry {
  archivePath: string
  zipPath: string
  size: number
  hash: string
}

export interface BackupPayload {
  schemaVersion: 1 | 2
  exportedAt: string
  modules: AppSnapshot['modules']
  records: AppSnapshot['records']
  characters: AppSnapshot['characters']
  settings: AppSnapshot['settings']
  importMappings: AppSnapshot['importMappings']
  archiveEntries: ArchiveEntry[]
  notes?: NoteRecord[]
  manifest?: BackupManifestEntry[]
  noteImages?: BackupManifestEntry[]
}

export interface BackupResult {
  path: string
  format: 'json' | 'zip'
  size: number
}

export interface BackupPreview {
  token: string
  format: 'json' | 'zip'
  exportedAt: string
  modules: number
  records: number
  characters: number
  archiveFiles: number
  archiveBytes: number
  warnings: string[]
}

interface PendingRestore {
  payload: BackupPayload
  archiveFiles: Map<string, Buffer>
}

function timestamp(): string {
  const date = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function safeZipPath(value: string): boolean {
  return Boolean(value) && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..')
}

export class BackupService {
  private readonly pending = new Map<string, PendingRestore>()
  private automaticTimer: NodeJS.Timeout | undefined
  private automaticBackupRunning = false

  constructor(
    private readonly repository: AppRepository,
    private readonly dataDirectory: string,
    private readonly cacheDirectory: string
  ) {}

  startAutomaticBackups(): void {
    this.stopAutomaticBackups()
    const settings = this.repository.getSettings().autoBackup
    if (!settings.enabled || settings.interval === 'idle') return
    const dayMs = 24 * 60 * 60 * 1000
    const intervalMs = settings.interval === 'daily' ? dayMs : 7 * dayMs
    this.automaticTimer = setInterval(() => {
      void this.createAutomaticBackup().catch(() => undefined)
    }, intervalMs)
    this.automaticTimer.unref()
  }

  refreshAutomaticBackups(): void {
    this.startAutomaticBackups()
  }

  stopAutomaticBackups(): void {
    if (this.automaticTimer) clearTimeout(this.automaticTimer)
    this.automaticTimer = undefined
  }

  queueAutomaticBackup(delayMs = 1500): void {
    const settings = this.repository.getSettings().autoBackup
    if (!settings.enabled) {
      this.stopAutomaticBackups()
      return
    }
    if (settings.interval !== 'idle') return
    if (this.automaticTimer) clearTimeout(this.automaticTimer)
    this.automaticTimer = setTimeout(() => {
      this.automaticTimer = undefined
      void this.createAutomaticBackup().catch(() => undefined)
    }, delayMs)
    this.automaticTimer.unref()
  }

  async createAutomaticBackup(): Promise<BackupResult | undefined> {
    const settings = this.repository.getSettings().autoBackup
    if (!settings.enabled || this.automaticBackupRunning) return undefined
    this.automaticBackupRunning = true
    try {
      const destination = path.join(this.dataDirectory, 'auto-backups')
      const result = await this.createBackup(false, destination)
      this.pruneAutomaticBackups(settings.retention)
      return result
    } finally {
      this.automaticBackupRunning = false
    }
  }

  async createBackup(
    includeArchives: boolean,
    destinationDirectory = path.join(this.dataDirectory, 'backups')
  ): Promise<BackupResult> {
    fs.mkdirSync(destinationDirectory, { recursive: true })
    const payload = this.createPayload(includeArchives)
    const extension = includeArchives ? 'zip' : 'json'
    const destination = this.nextFile(destinationDirectory, `coc-backup-${timestamp()}.${extension}`)
    const temporary = `${destination}.${process.pid}.tmp`
    try {
      if (!includeArchives) fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), 'utf8')
      else await this.writeZip(temporary, payload)
      const size = fs.statSync(temporary).size
      if (!size) throw new Error('备份文件为空')
      fs.renameSync(temporary, destination)
      return { path: destination, format: includeArchives ? 'zip' : 'json', size }
    } catch (error) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
      throw new AppError('BACKUP_FAILED', 'BACKUP', '备份生成失败。', true, error)
    }
  }

  async previewBackup(filePath: string): Promise<BackupPreview> {
    const extension = path.extname(filePath).toLowerCase()
    const prepared =
      extension === '.json'
        ? this.readJson(filePath)
        : extension === '.zip'
          ? await this.readZip(filePath)
          : undefined
    if (!prepared) throw new AppError('BACKUP_TYPE_INVALID', 'BACKUP', '只支持 JSON 或 ZIP 备份文件。')
    const { payload, archiveFiles } = prepared
    this.validatePayload(payload)
    const token = randomUUID()
    this.pending.set(token, prepared)
    const warnings: string[] = []
    if (payload.records.some((record) => record.rawContent))
      warnings.push('备份包含可重建缓存；恢复时会忽略缓存正文。')
    if (!archiveFiles.size && payload.archiveEntries.length)
      warnings.push('此备份未包含归档文件，仅恢复数据登记。')
    return {
      token,
      format: extension === '.zip' ? 'zip' : 'json',
      exportedAt: payload.exportedAt,
      modules: payload.modules.length,
      records: payload.records.length,
      characters: payload.characters.length,
      archiveFiles: archiveFiles.size,
      archiveBytes: Array.from(archiveFiles.values()).reduce((sum, value) => sum + value.length, 0),
      warnings
    }
  }

  restore(token: string, options: { restoreSettings: boolean; archiveDirectory?: string }): void {
    const prepared = this.pending.get(token)
    if (!prepared) throw new AppError('RESTORE_EXPIRED', 'BACKUP', '恢复预览已过期，请重新选择备份。')
    const targetArchive = path.resolve(
      options.archiveDirectory ?? this.repository.getSettings().archiveDirectory
    )
    const currentSafety = this.createSafetyBackup()
    try {
      const snapshot = structuredClone(prepared.payload) as AppSnapshot
      snapshot.records = snapshot.records.map((record) => ({
        ...record,
        rawContent: undefined,
        fetchedAt: undefined,
        cacheSourceUrl: undefined
      }))
      snapshot.archiveEntries = this.restoreArchives(prepared.payload, prepared.archiveFiles, targetArchive)
      this.restoreNoteImages(prepared.archiveFiles)
      this.repository.replaceFromBackup(snapshot, {
        restoreSettings: options.restoreSettings,
        archiveDirectory: targetArchive
      })
      this.pending.delete(token)
    } catch (error) {
      throw new AppError(
        'RESTORE_FAILED',
        'BACKUP',
        `恢复失败；当前数据安全副本位于：${currentSafety}`,
        false,
        error
      )
    }
  }

  cacheStats(): { bytes: number; files: number } {
    if (!fs.existsSync(this.cacheDirectory)) return { bytes: 0, files: 0 }
    const entries = this.walk(this.cacheDirectory)
    return { bytes: entries.reduce((sum, file) => sum + fs.statSync(file).size, 0), files: entries.length }
  }

  clearCache(): { bytes: number; files: number } {
    const stats = this.cacheStats()
    if (fs.existsSync(this.cacheDirectory)) fs.rmSync(this.cacheDirectory, { recursive: true, force: true })
    return stats
  }

  clearBusinessData(options: {
    resetSettings: boolean
    clearMappings: boolean
    deleteRegisteredArchives: boolean
  }): number {
    const snapshot = this.repository.snapshot()
    let deleted = 0
    if (options.deleteRegisteredArchives) {
      const root = path.resolve(snapshot.settings.archiveDirectory)
      for (const entry of snapshot.archiveEntries) {
        const candidate = path.resolve(entry.path)
        if (!isPathInside(root, candidate) || !fs.existsSync(candidate)) continue
        fs.unlinkSync(candidate)
        deleted += 1
      }
    }
    this.repository.clearBusinessData(options)
    return deleted
  }

  private createPayload(includeArchives: boolean): BackupPayload {
    const snapshot = this.repository.snapshot()
    const root = path.resolve(snapshot.settings.archiveDirectory)
    const archiveEntries = snapshot.archiveEntries.map((entry) => {
      const relative = isPathInside(root, path.resolve(entry.path)) ? path.relative(root, entry.path) : ''
      return { ...entry, path: relative, exists: includeArchives && entry.exists && Boolean(relative) }
    })
    return {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      modules: snapshot.modules,
      records: snapshot.records.map((record) => ({
        ...record,
        rawContent: undefined,
        fetchedAt: undefined,
        cacheSourceUrl: undefined
      })),
      characters: snapshot.characters,
      settings: snapshot.settings,
      importMappings: snapshot.importMappings,
      archiveEntries,
      notes: snapshot.notes,
      manifest: includeArchives ? this.manifestFor(root, snapshot.archiveEntries) : undefined,
      noteImages: includeArchives ? this.noteImageManifest(snapshot.notes) : undefined
    }
  }

  private manifestFor(root: string, entries: ArchiveEntry[]): BackupManifestEntry[] {
    return entries.flatMap((entry) => {
      const candidate = path.resolve(entry.path)
      if (!isPathInside(root, candidate) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile())
        return []
      const bytes = fs.readFileSync(candidate)
      const relative = path.relative(root, candidate)
      return [
        {
          archivePath: relative,
          zipPath: `archives/${relative.replaceAll('\\', '/')}`,
          size: bytes.length,
          hash: sha256(bytes)
        }
      ]
    })
  }

  private noteImageManifest(notes: NoteRecord[]): BackupManifestEntry[] {
    const seen = new Set<string>()
    return notes.flatMap((note) =>
      note.images.flatMap((image) => {
        if (seen.has(image.path)) return []
        const candidate = path.resolve(this.dataDirectory, image.path)
        if (!isPathInside(this.dataDirectory, candidate) || !fs.existsSync(candidate)) return []
        seen.add(image.path)
        const bytes = fs.readFileSync(candidate)
        return [
          {
            archivePath: image.path,
            zipPath: image.path.replaceAll('\\', '/'),
            size: bytes.length,
            hash: sha256(bytes)
          }
        ]
      })
    )
  }

  private writeZip(destination: string, payload: BackupPayload): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(destination)
      const archive = new ZipArchive({ zlib: { level: 9 } })
      output.once('close', resolve)
      output.once('error', reject)
      archive.once('error', reject)
      archive.pipe(output)
      archive.append(JSON.stringify(payload, null, 2), { name: 'backup.json' })
      const root = path.resolve(this.repository.getSettings().archiveDirectory)
      for (const item of payload.manifest ?? []) {
        const candidate = path.resolve(root, item.archivePath)
        if (isPathInside(root, candidate) && fs.existsSync(candidate))
          archive.file(candidate, { name: item.zipPath })
      }
      for (const item of payload.noteImages ?? []) {
        const candidate = path.resolve(this.dataDirectory, item.archivePath)
        if (isPathInside(this.dataDirectory, candidate) && fs.existsSync(candidate))
          archive.file(candidate, { name: item.zipPath })
      }
      void archive.finalize()
    })
  }

  private readJson(filePath: string): PendingRestore {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BackupPayload
    return { payload, archiveFiles: new Map() }
  }

  private async readZip(filePath: string): Promise<PendingRestore> {
    const directory = await unzipper.Open.buffer(fs.readFileSync(filePath))
    const backup = directory.files.find((file) => file.path === 'backup.json')
    if (!backup) throw new AppError('BACKUP_ZIP_DATA_MISSING', 'BACKUP', 'ZIP 备份中缺少 backup.json。')
    const payload = JSON.parse((await backup.buffer()).toString('utf8')) as BackupPayload
    const archiveFiles = new Map<string, Buffer>()
    for (const file of directory.files) {
      if (file.type !== 'File') continue
      if (!file.path.startsWith('archives/') && !file.path.startsWith('notes/')) continue
      if (!safeZipPath(file.path))
        throw new AppError('BACKUP_ZIP_PATH_INVALID', 'BACKUP', 'ZIP 内含不安全路径。')
      archiveFiles.set(file.path, await file.buffer())
    }
    return { payload, archiveFiles }
  }

  private restoreArchives(
    payload: BackupPayload,
    files: Map<string, Buffer>,
    target: string
  ): ArchiveEntry[] {
    fs.mkdirSync(target, { recursive: true })
    const manifest = new Map((payload.manifest ?? []).map((item) => [item.archivePath, item]))
    return payload.archiveEntries.map((entry) => {
      const manifestItem = manifest.get(entry.path)
      const bytes = manifestItem ? files.get(manifestItem.zipPath) : undefined
      if (!manifestItem || !bytes || !safeZipPath(entry.path) || sha256(bytes) !== manifestItem.hash) {
        return { ...entry, path: entry.path, exists: false }
      }
      const requested = path.resolve(target, entry.path)
      if (!isPathInside(target, requested)) return { ...entry, exists: false }
      fs.mkdirSync(path.dirname(requested), { recursive: true })
      const destination = this.nextFile(path.dirname(requested), path.basename(requested))
      fs.writeFileSync(destination, bytes)
      return { ...entry, path: destination, size: bytes.length, hash: sha256(bytes), exists: true }
    })
  }

  private restoreNoteImages(files: Map<string, Buffer>): void {
    const directory = path.join(this.dataDirectory, 'notes')
    fs.mkdirSync(directory, { recursive: true })
    for (const [zipPath, bytes] of files) {
      if (!zipPath.startsWith('notes/') || !safeZipPath(zipPath)) continue
      fs.writeFileSync(path.join(directory, path.basename(zipPath)), bytes)
    }
  }

  private createSafetyBackup(): string {
    const directory = path.join(this.dataDirectory, 'safety-backups')
    fs.mkdirSync(directory, { recursive: true })
    const destination = this.nextFile(directory, `before-restore-${timestamp()}.json`)
    fs.writeFileSync(destination, JSON.stringify(this.createPayload(false), null, 2), 'utf8')
    return destination
  }

  private pruneAutomaticBackups(retention: number): void {
    const directory = path.join(this.dataDirectory, 'auto-backups')
    if (!fs.existsSync(directory)) return
    const keep = Math.max(1, Math.floor(retention))
    const files = fs
      .readdirSync(directory)
      .filter((file) => /^coc-backup-.*\.(json|zip)$/i.test(file))
      .map((file) => {
        const filePath = path.join(directory, file)
        return { path: filePath, modifiedAt: fs.statSync(filePath).mtimeMs }
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
    for (const file of files.slice(keep)) fs.unlinkSync(file.path)
  }
  private nextFile(directory: string, requested: string): string {
    const safe =
      sanitizeWindowsName(requested.slice(0, -path.extname(requested).length)) + path.extname(requested)
    return path.join(directory, nextAvailableName(fs.readdirSync(directory), safe))
  }

  private walk(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const item = path.join(directory, entry.name)
      return entry.isDirectory() ? this.walk(item) : entry.isFile() ? [item] : []
    })
  }

  private validatePayload(payload: BackupPayload): void {
    if (
      !payload ||
      (payload.schemaVersion !== 1 && payload.schemaVersion !== 2) ||
      !Array.isArray(payload.modules) ||
      !Array.isArray(payload.records) ||
      !Array.isArray(payload.characters)
    )
      throw new AppError('BACKUP_INVALID', 'BACKUP', '备份文件结构无效或版本不兼容。')
  }
}
