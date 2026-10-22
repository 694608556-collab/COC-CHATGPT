import { validateBackupRecord, validateOverviewBytes, backupArchiveReferences } from './backup'
import { capacity } from './capacity'
import { StreamJson, checkStreamBudget, checkStreamCancelled } from './stream-json'
import { StreamSha256 } from './stream-sha256'
import type { MobileSnapshot } from './types'
import type { SessionRecord } from '../../../src/shared/types'
import { recordJsonWithBodyTokens } from './backup-body-tokens'

const encoder = new TextEncoder()
const encodeUtf8 = (text: string) => encoder.encode(text)

export interface StreamProof {
  bytes: number
  sha256: string
}
export type BodylessRecord = Omit<SessionRecord, 'rawContent' | 'manualContent'> & {
  rawContent?: never
  manualContent?: never
}
export type StreamBackupHeader = Omit<MobileSnapshot, 'records'> & {
  readonly records: readonly SessionRecord[]
}
/** Read-only bodyless rows deliberately cannot be assigned to a full mutable
 * MobileSnapshot for an ordinary replace/restore call. */
export type StreamBackupMetadata = Omit<MobileSnapshot, 'records'> & {
  readonly records: readonly BodylessRecord[]
}
/** No body is included in this metadata. It is never a complete commit candidate. */
export interface StreamBackupPreview {
  metadata: StreamBackupMetadata
  offlineRecords: number
  source: StreamProof
  warnings: string[]
  archive: ReturnType<typeof backupArchiveReferences>
}
export interface StreamReadOptions {
  /** A trusted per-operation budget; production must obtain it from the native storage boundary. */
  maximumBytes: number
  signal?: AbortSignal
  /** Consumer may only stage privately. Any subsequent parse/graph/hash failure invalidates ALL staged records. */
  stageRecord(record: SessionRecord, index: number, json?: string): Promise<void>
  preserveBodyTokens?: boolean
  expectedSource?: StreamProof
  /** Only ZIP input interprets archive manifests; plain legacy JSON ignores them. */
  archiveReferences?: boolean
}
export function recordMetadata(record: SessionRecord): BodylessRecord {
  const { rawContent, manualContent, ...metadata } = record
  return metadata
}

/** Read legacy schema 1/2 JSON and existing mobile envelopes without whole-file allocation.
 * One complete record uses available runtime memory and the operation's actual
 * storage budget; records are awaited to enforce backpressure.
 * A successful result still grants no database/authorization/commit capability.
 */
export async function readBackupJsonStream(
  source: AsyncIterable<Uint8Array>,
  options: StreamReadOptions
): Promise<StreamBackupPreview> {
  const reader = new StreamJson(source, options.maximumBytes, options.maximumBytes, options.signal)
  const flat: Record<string, unknown> = Object.create(null)
  const nested: Record<string, unknown> = Object.create(null)
  const records: SessionRecord[] = []
  let offlineRecords = 0,
    flatRecords = false,
    nestedRecords = false,
    hasSnapshot = false
  const retained = new Set([
    'schemaVersion',
    'exportedAt',
    'modules',
    'characters',
    'settings',
    'manifest',
    'noteImages',
    'archiveEntries',
    'format',
    'formatVersion'
  ])
  async function field(target: Record<string, unknown>, name: string, envelope: boolean) {
    if (name === 'records') {
      if (flatRecords || nestedRecords) throw new Error('备份包含多个场次数组。')
      if (envelope) nestedRecords = true
      else flatRecords = true
      await reader.array(async () => {
        checkStreamCancelled(options.signal)
        const original = await reader.readRawValue()
        const record = validateBackupRecord(original.value)
        const preserved = options.preserveBodyTokens
          ? recordJsonWithBodyTokens(record, original.value, original.json)
          : undefined
        const metadata = recordMetadata(record)
        await options.stageRecord(record, records.length, preserved)
        records.push(metadata)
        if (record.rawContent || (record.sourceType === 'manual' && record.manualContent)) offlineRecords++
      })
    } else {
      // Entity collections and individual values use the actual operation budget.
      if (['modules', 'characters', 'manifest', 'noteImages', 'archiveEntries'].includes(name)) {
        const values: unknown[] = []
        await reader.array(async () => {
          values.push(await reader.readValue())
        })
        target[name] = values
      } else {
        const value = await reader.readValue()
        if (retained.has(name)) target[name] = value
      }
    }
  }
  try {
    await reader.object(async (key) => {
      if (key === 'snapshot') {
        hasSnapshot = true
        await reader.object((name) => field(nested, name, true))
      } else await field(flat, key, false)
    })
    const proof = await reader.finish()
    if (
      options.expectedSource &&
      (proof.bytes !== options.expectedSource.bytes || proof.sha256 !== options.expectedSource.sha256)
    )
      throw new Error('完整来源长度或摘要不符，预览已失效。')
    const envelope = flat.format === 'coc.logbook.android'
    if (
      envelope !== hasSnapshot ||
      (envelope && (flat.formatVersion !== 1 || !nestedRecords)) ||
      (!envelope && !flatRecords)
    )
      throw new Error('备份版本或场次结构不完整。')
    const root = envelope ? nested : flat
    root.records = records
    const input = envelope ? { ...flat, snapshot: root } : root
    const bytes = encodeUtf8(JSON.stringify(input))
    const checked = await validateOverviewBytes(bytes)
    const archive = options.archiveReferences
      ? backupArchiveReferences(flat, root)
      : { integrity: [], attachments: [] }
    const warnings = checked.warnings.filter((message) => !message.includes('个场次未带正文'))
    if (offlineRecords < records.length)
      warnings.push(`${records.length - offlineRecords} 个场次未带正文，导入后不能凭链接离线阅读。`)
    return {
      metadata: { ...checked.snapshot, records: checked.snapshot.records.map(recordMetadata) },
      offlineRecords,
      source: proof,
      warnings,
      archive
    }
  } finally {
    await reader.close()
  }
}

export interface StreamArchiveReference {
  archivePath: string
  zipPath: string
  size: number
  hash: string
}
export interface StreamWriteOptions {
  maximumBytes: number
  signal?: AbortSignal
  archives?: readonly StreamArchiveReference[]
  exportedAt?: string
}
/** Complete schema-2 backup output. Sink must be private and unpublished until
 * this promise, all source proofs, native validation and final CAS succeed.
 */
export async function writeBackupJsonStream(
  metadata: StreamBackupHeader,
  records: AsyncIterable<SessionRecord>,
  sink: (chunk: Uint8Array) => Promise<void>,
  options: StreamWriteOptions
): Promise<StreamProof> {
  checkStreamBudget(options.maximumBytes)
  if (
    metadata.records.some((record) => record.rawContent !== undefined || record.manualContent !== undefined)
  )
    throw new Error('流式备份头只能包含元数据，不能携带整库正文。')
  const checked = (await validateOverviewBytes(encodeUtf8(JSON.stringify(metadata)))).snapshot
  const digest = new StreamSha256()
  async function emit(text: string) {
    checkStreamCancelled(options.signal)
    const bytes = encodeUtf8(text)
    for (let offset = 0; offset < bytes.length; offset += capacity.transferChunkBytes) {
      checkStreamCancelled(options.signal)
      const chunk = bytes.subarray(offset, offset + capacity.transferChunkBytes)
      if (digest.bytes + chunk.length > options.maximumBytes) throw new Error('完整备份超过本次可用空间。')
      await sink(chunk)
      digest.update(chunk)
    }
  }
  const archives = options.archives
  await emit(
    '{"format":"coc.logbook.android","formatVersion":1,"exportedAt":' +
      JSON.stringify(options.exportedAt ?? new Date().toISOString()) +
      ',"restoreScope":["modules","records","characters"]' +
      (archives ? ',"manifest":' + JSON.stringify(archives) : '') +
      ',"snapshot":{'
  )
  let first = true
  for (const key of ['schemaVersion', 'exportedAt', 'modules', 'characters', 'settings'] as const) {
    await emit((first ? '' : ',') + JSON.stringify(key) + ':' + JSON.stringify(checked[key]))
    first = false
  }
  if (archives)
    await emit(
      ',"manifest":' +
        JSON.stringify(archives) +
        ',"archiveEntries":' +
        JSON.stringify(archives.map((item) => ({ path: item.archivePath, ownerType: 'record' })))
    )
  await emit(',"records":[')
  let index = 0
  for await (const value of records) {
    checkStreamCancelled(options.signal)
    const record = validateBackupRecord(value)
    const json = JSON.stringify(record)
    if (JSON.stringify(recordMetadata(record)) !== JSON.stringify(checked.records[index]))
      throw new Error('备份场次缺失、重复、顺序或元数据已变化。')
    await emit((index ? ',' : '') + json)
    index++
  }
  if (index !== checked.records.length) throw new Error('备份场次未取齐，不能发布文件。')
  await emit(']}}')
  return { bytes: digest.bytes, sha256: digest.digest() }
}
