import { z } from 'zod'
import { unzipSync } from 'fflate'
import { addStreamBytes } from './stream-json'
import { StreamSha256 } from './stream-sha256'
import { DEFAULT_FILTER_PRESET } from '../../../src/shared/types'
import type { ImportPreview, MobileSnapshot } from './types'
import type { SessionRecord } from '../../../src/shared/types'

const string = z.string()
const number = z.number().finite()
const optionalString = string.optional()
const moduleSchema = z.object({
  id: string.min(1),
  name: string,
  playStatus: z.enum(['finished', 'running', 'not_started']).default('not_started'),
  kps: z.array(string),
  pairs: z.array(z.object({ pc: string, pl: string, characterId: optionalString })),
  order: number,
  collapsed: z.boolean(),
  createdAt: string,
  updatedAt: string
})
const logSchema = z.object({
  title: optionalString,
  sourceUrl: optionalString,
  responseHash: optionalString,
  parserVersion: number,
  messages: z.array(
    z.object({
      id: string,
      order: number,
      timestamp: optionalString,
      displayName: string,
      platformAccount: optionalString,
      text: string,
      type: string,
      isDiceCommand: z.boolean(),
      isOffTopic: z.boolean(),
      images: z.array(z.object({ url: string, alt: optionalString })),
      raw: z.unknown().optional()
    })
  )
})
const recordSchema = z.object({
  id: string.min(1),
  moduleId: string.min(1),
  name: string,
  sequenceNo: number.default(0),
  link: optionalString,
  sourceType: z.enum(['online', 'manual']),
  status: z.enum(['pending', 'valid', 'invalid', 'fetch_failed', 'manual']),
  previousStatus: z.enum(['pending', 'valid', 'invalid', 'fetch_failed', 'manual']).optional(),
  playDate: optionalString,
  dateSource: z.enum(['parsed', 'manual', 'none']),
  fetchedAt: optionalString,
  rawContent: logSchema.optional(),
  manualContent: optionalString,
  cacheSourceUrl: optionalString,
  lastError: optionalString,
  order: number,
  createdAt: string,
  updatedAt: string
})

/** Same normalized record schema as legacy preview, without retaining other bodies. */
export function validateBackupRecord(value: unknown): SessionRecord {
  const record = recordSchema.parse(value)
  if (
    record.sourceType === 'online' &&
    record.rawContent &&
    ((record.cacheSourceUrl && record.cacheSourceUrl !== record.link) ||
      (record.rawContent.sourceUrl && record.rawContent.sourceUrl !== record.link))
  )
    throw new Error('正文来源与场次链接不匹配。')
  return record
}

/** ZIP references have the same shapes and selection rules as legacy preview. */
export function backupArchiveReferences(outer: unknown, root: unknown) {
  const integrity = z
    .object({
      manifest: z.array(z.object({ zipPath: string, size: number, hash: string })).default([]),
      noteImages: z.array(z.object({ zipPath: string, size: number, hash: string })).default([])
    })
    .parse(outer)
  const selected = z
    .object({
      archiveEntries: z.array(z.object({ path: string, ownerType: string })).default([]),
      manifest: z
        .array(z.object({ archivePath: string, zipPath: string, size: number, hash: string }))
        .default([])
    })
    .parse(root)
  const seen = new Set<string>()
  const ownedPaths = new Set(
    selected.archiveEntries
      .filter((entry) => ['record', 'module'].includes(entry.ownerType))
      .map((entry) => entry.path)
  )
  return {
    integrity: [...integrity.manifest, ...integrity.noteImages],
    attachments: selected.manifest.filter((item) => {
      if (seen.has(item.zipPath) || !ownedPaths.has(item.archivePath)) return false
      seen.add(item.zipPath)
      return true
    })
  }
}
const characterSchema = z.object({
  id: string.min(1),
  moduleId: optionalString,
  moduleIds: z.array(string).default([]),
  edition: z.union([z.literal(6), z.literal(7)]),
  basic: z.object({
    name: string,
    occupation: string,
    age: string,
    gender: string,
    birthplace: string,
    residence: string
  }),
  attrs: z.object({
    STR: number,
    CON: number,
    SIZ: number,
    DEX: number,
    APP: number,
    INT: number,
    POW: number,
    EDU: number
  }),
  editionSnapshots: z.record(string, z.record(string, number)).default({}),
  derived: z.object({
    hpCurrent: number,
    mpCurrent: number,
    sanCurrent: number,
    luck6: number.optional(),
    luck7: number.optional(),
    db: string
  }),
  occupationFormula: string,
  occupationPointOverride: number.optional(),
  skills: z.array(
    z.object({
      id: string,
      name: string,
      base: number,
      occupation: number,
      interest: number,
      growth: number,
      hidden: z.boolean().optional(),
      builtIn: z.boolean().optional(),
      mappingState: z.enum(['ok', 'review', 'unmapped']).optional()
    })
  ),
  weapons: z.array(z.record(string, z.union([string, number]))),
  items: z.array(string),
  background: z.record(string, string),
  story: string,
  createdAt: string,
  updatedAt: string
})
const filterSchema = z.object(
  Object.fromEntries(Object.keys(DEFAULT_FILTER_PRESET).map((key) => [key, z.boolean().optional()]))
)
const payloadSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  exportedAt: string,
  modules: z.array(moduleSchema),
  records: z.array(recordSchema),
  characters: z.array(characterSchema),
  settings: z
    .object({
      theme: z.enum(['light', 'dark']).optional(),
      filterPreset: filterSchema.optional(),
      autoBackup: z
        .object({
          enabled: z.boolean(),
          interval: z.enum(['idle', 'daily', 'weekly']),
          retention: z.number().int().positive().default(10)
        })
        .optional()
    })
    .optional()
})

/**
 * 校验用户选择的 JSON 备份，构造仅含安卓业务的数据；不写数据库。
 * @param bytes - 原始备份 UTF-8 字节。
 * @returns 已剔除电脑专属数据的预览及正文数量。
 * @throws 版本、实体结构或 JSON 不合法时拒绝导入。
 */
export function previewBackup(bytes: Uint8Array): Promise<ImportPreview> {
  return previewBounded(bytes)
}

/** Validate an internal complete candidate using its request budget, with the
 * same format, body, attachment and association checks as backup preview.
 */
export function validateSnapshotBytes(bytes: Uint8Array): Promise<ImportPreview> {
  return previewBounded(bytes)
}

/** Validate a body-free overview without imposing a whole-library byte budget. */
export async function validateOverviewBytes(bytes: Uint8Array): Promise<ImportPreview> {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) throw new Error('概览格式无效。')
  const result = await previewBounded(bytes)
  if (
    result.snapshot.records.some(
      (record) => record.rawContent !== undefined || record.manualContent !== undefined
    )
  )
    throw new Error('概览包含正文，不能作为轻量列表读取。')
  return result
}

async function previewBounded(bytes: Uint8Array): Promise<ImportPreview> {
  if (!bytes.length) throw new Error('备份不能为空。')
  let input: unknown
  let zipFiles: Record<string, Uint8Array> | undefined
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const seen = new Set<string>()
    let total = 0
    const files = unzipSync(bytes, {
      filter: (info) => {
        if (
          !info.name ||
          info.name.includes('\\') ||
          info.name.includes('\0') ||
          info.name.startsWith('/') ||
          /^[A-Za-z]:/.test(info.name) ||
          info.name.split('/').includes('..')
        )
          throw new Error('ZIP 路径校验失败。')
        if (seen.has(info.name)) throw new Error('ZIP 条目重复，校验失败。')
        seen.add(info.name)
        total += info.originalSize
        if (!Number.isSafeInteger(total)) throw new Error('ZIP 解压大小超出系统可精确计量范围。')
        return !info.name.endsWith('/')
      }
    })
    const data = files['backup.json']
    zipFiles = files
    if (!data) throw new Error('ZIP 校验失败：缺少 backup.json。')
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))
    const manifests = z
      .object({
        manifest: z.array(z.object({ zipPath: string, size: number, hash: string })).optional(),
        noteImages: z.array(z.object({ zipPath: string, size: number, hash: string })).optional()
      })
      .parse(input)
    for (const item of [...(manifests.manifest ?? []), ...(manifests.noteImages ?? [])]) {
      const file = files[item.zipPath]
      if (!file || file.length !== item.size) throw new Error('ZIP 文件大小或存在性校验失败。')
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(file).buffer))
      )
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      if (hash !== item.hash.toLowerCase()) throw new Error('ZIP 文件摘要校验失败。')
    }
  } else input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  return validateParsedSnapshot(input, zipFiles)
}

/** 校验内部已解码的 JSON 值，复用备份入口的全部实体、正文、设置和关联检查。
 * @param input - JSON 解析或 Worker 结构化复制得到的候选值；文件字节仍由原入口严格解码。
 * @returns 与字节入口相同的规范快照及预览；不写入数据，不持有文件权限。
 */
export function validateSnapshotValue(input: unknown): Promise<ImportPreview> {
  return validateParsedSnapshot(input)
}

/** @param input - 已解码候选值。 @param zipFiles - 已经过容器及清单摘要校验的 ZIP 文件。
 * @returns 完整规范预览；两种输入入口共用此处所有业务校验。
 */
async function validateParsedSnapshot(
  input: unknown,
  zipFiles?: Record<string, Uint8Array>
): Promise<ImportPreview> {
  if (!input || typeof input !== 'object') throw new Error('备份结构校验失败。')
  let root = input as Record<string, unknown>
  const androidEnvelope = root.format === 'coc.logbook.android'
  if (root.format === 'coc.logbook.android') {
    if (root.formatVersion !== 1 || !root.snapshot || typeof root.snapshot !== 'object')
      throw new Error('手机备份版本不兼容。')
    root = root.snapshot as Record<string, unknown>
  }
  if (root.schemaVersion !== 1 && root.schemaVersion !== 2) throw new Error('备份版本不兼容。')
  const parsed = payloadSchema.safeParse(root)
  if (!parsed.success) throw new Error('备份数据结构无效；未写入任何数据。')
  const payload = parsed.data
  for (const rows of [payload.modules, payload.records, payload.characters]) {
    if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error('备份包含重复标识。')
  }
  const modules = new Set(payload.modules.map((m) => m.id))
  const characters = new Set(payload.characters.map((c) => c.id))
  if (
    payload.records.some((r) => !modules.has(r.moduleId)) ||
    payload.characters.some((c) =>
      [...c.moduleIds, ...(c.moduleId ? [c.moduleId] : [])].some((id) => !modules.has(id))
    ) ||
    payload.modules.some((m) => m.pairs.some((p) => p.characterId && !characters.has(p.characterId)))
  )
    throw new Error('备份包含失效的业务关联。')
  if (
    payload.records.some(
      (r) =>
        r.sourceType === 'online' &&
        r.rawContent &&
        ((r.cacheSourceUrl && r.cacheSourceUrl !== r.link) ||
          (r.rawContent.sourceUrl && r.rawContent.sourceUrl !== r.link))
    )
  )
    throw new Error('正文来源与场次链接不匹配。')
  const snapshot: MobileSnapshot = {
    schemaVersion: 2,
    exportedAt: payload.exportedAt,
    modules: payload.modules,
    records: payload.records,
    characters: payload.characters,
    settings: {
      theme: payload.settings?.theme ?? 'light',
      filterPreset: {
        ...DEFAULT_FILTER_PRESET,
        ...payload.settings?.filterPreset,
        indentFirstLine: false,
        darkDisplay: false
      },
      autoBackup:
        payload.settings?.autoBackup &&
        (androidEnvelope ||
          !(root.settings && typeof root.settings === 'object' && 'archiveDirectory' in root.settings))
          ? { ...payload.settings.autoBackup, retention: 10 }
          : undefined
    }
  }
  const offlineRecords = snapshot.records.filter(
    (r) => r.rawContent || (r.sourceType === 'manual' && r.manualContent)
  ).length
  const attachments: NonNullable<ImportPreview['attachments']> = []
  if (zipFiles) {
    const entries = z
      .object({
        archiveEntries: z.array(z.object({ path: string, ownerType: string })).default([]),
        manifest: z
          .array(z.object({ archivePath: string, zipPath: string, size: number, hash: string }))
          .default([])
      })
      .parse(root)
    const used = new Set<string>()
    for (const item of entries.manifest) {
      if (
        !entries.archiveEntries.some(
          (entry) => entry.path === item.archivePath && ['record', 'module'].includes(entry.ownerType)
        )
      )
        continue
      if (used.has(item.zipPath)) continue
      const bytes = zipFiles[item.zipPath]
      if (!bytes) throw new Error('归档附件不存在。')
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)),
        (b) => b.toString(16).padStart(2, '0')
      ).join('')
      if (bytes.length !== item.size || hash !== item.hash.toLowerCase())
        throw new Error('归档附件大小或摘要校验失败。')
      const name = item.archivePath.split(/[\\/]/).pop() || '归档文件'
      const extension = name.split('.').pop()?.toLowerCase()
      const mime =
        (
          {
            txt: 'text/plain',
            json: 'application/json',
            doc: 'application/msword',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            pdf: 'application/pdf',
            csv: 'text/csv',
            xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          } as Record<string, string>
        )[extension ?? ''] ?? 'application/octet-stream'
      attachments.push({ name, mime, bytes })
      used.add(item.zipPath)
    }
  }
  const warnings = [
    '手机版不保留资料汇总与跑团闲记。',
    attachments.length
      ? '将恢复 ' + attachments.length + ' 份跑团记录/模组归档文件，创建新文件，不覆盖同名文件。'
      : '此备份不含可恢复的跑团归档附件。'
  ]
  if (offlineRecords < snapshot.records.length)
    warnings.push(`${snapshot.records.length - offlineRecords} 个场次未带正文，导入后不能凭链接离线阅读。`)
  return { snapshot, offlineRecords, warnings, attachments }
}

/**
 * 编码安卓完整文字备份。
 * @param snapshot - 当前安卓业务数据，不含电脑专属模块。
 * @returns 可写入用户归档目录的 UTF-8 字节。
 */
export function encodeBackup(snapshot: MobileSnapshot): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      format: 'coc.logbook.android',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      restoreScope: ['modules', 'records', 'characters'],
      snapshot
    })
  )
}
/**
 * 编码含完整业务快照及全部已验证附件的 ZIP64，保留原完整备份格式。
 * @param snapshot - 完整业务快照，不修改原数据。
 * @param files - 全部附件字节；不能为减少资源使用而省略附件。
 * @returns 可供既有恢复器读取的完整 ZIP64；实际内存或校验失败时拒绝，不发布部分文件。
 */
export async function encodeArchiveBackup(
  snapshot: MobileSnapshot,
  files: Array<{ name: string; bytes: Uint8Array }>
) {
  // Browser/legacy callers already own their objects in RAM. Reuse the same
  // ZIP64 writer so this entry point cannot retain the ZIP32 format ceiling.
  const { writeBackupZipStream } = await import('./backup-zip-stream')
  const { recordMetadata } = await import('./backup-stream')
  const { capacity } = await import('./capacity')
  const parts: Uint8Array[] = []
  let total = 0
  async function* records() {
    yield* snapshot.records
  }
  const attachments = files.map((file) => {
    const digest = new StreamSha256()
    digest.update(file.bytes)
    return {
      name: file.name,
      bytes: file.bytes.length,
      sha256: digest.digest(),
      chunks: (async function* () {
        for (let offset = 0; offset < file.bytes.length; offset += capacity.transferChunkBytes)
          yield file.bytes.subarray(offset, offset + capacity.transferChunkBytes)
      })()
    }
  })
  await writeBackupZipStream(
    { ...snapshot, records: snapshot.records.map(recordMetadata) },
    records(),
    attachments,
    async (chunk) => {
      total = addStreamBytes(total, chunk.length)
      parts.push(chunk.slice())
    },
    // Exact JS counter range only; allocation/I/O capacity controls feasibility.
    { maximumBytes: Number.MAX_SAFE_INTEGER }
  )
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}
