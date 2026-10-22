import { capacity } from './capacity'
import { previewBackup, validateSnapshotBytes, encodeBackup, encodeArchiveBackup } from './backup'
import { decodeBase64, encodeBase64, encodeUtf8 } from './bytes'
import type { MobileSnapshot } from './types'
import { readSource } from './local-source'
import type { ExportSource } from './export-source'
import { decodeSeaResponse } from './sea-response'
import { importTable } from './tables'
import { createTableDelta } from './table-delta'
import type { TablePhaseTiming } from './table-timing'
import type { SessionRecord } from '../../../src/shared/types'
import { withFetchedLog, withParseFailure } from './fetch-result'

/** 工作线程内已完整校验的上传租约；正文只保留为该线程内的字节。 */
export interface FetchUpload {
  /** 不带正文的场次元数据，仅在原生暂存成功后发布进度。 */
  record: SessionRecord
  /** 当前唯一上传租约标识。 */
  id: string
  /** 完整 UTF-8 字节数，不超过 64 MiB。 */
  bytes: number
  /** 完整字节 SHA-256。 */
  sha256: string
  /** 最多 256 KiB 一段的数量。 */
  count: number
}

/** 只读后台任务；不接触目录授权、数据库或原生写入接口。 */
export type SnapshotJob =
  | {
      /** 表格只读解析与预览校验，不持有写库能力。 */
      type: 'table-import'
      revision?: number
      /** 全部正文已读取的预览基线。 */
      snapshot: MobileSnapshot
      /** 已选文件的Base64内容。 */
      base64: string
      /** 文件名，用于识别CSV或工作簿。 */
      name: string
      /** 跑团场次或旧版角色表格。 */
      kind: 'records' | 'characters'
    }
  | { type: 'table-confirm'; id: string; revision: number; measure?: boolean }
  | { type: 'table-release'; id: string }
  | { type: 'preview'; bytes: Uint8Array }
  | { type: 'preview-base64'; base64: string }
  | { type: 'read'; json: string }
  | { type: 'checked-json'; json: string }
  | { type: 'prepare'; snapshot: MobileSnapshot; measure?: boolean }
  | { type: 'prepare-upload'; snapshot: MobileSnapshot }
  | {
      type: 'prepare-fetch-upload'
      /** 保留全部模组、角色及设置的基线，单场结果替换 records 候选。 */
      snapshot: MobileSnapshot
      /** 当前在线场次的来源/失败状态，不含旧正文。 */
      record: SessionRecord
      /** 已通过网络来源检查的响应；缺失表示网络失败，无需解析。 */
      text?: string
    }
  | { type: 'read-local'; source: ExportSource }
  | { type: 'upload-chunk'; id: string; index: number }
  | { type: 'upload-close'; id: string }
  | { type: 'serialize'; snapshot: MobileSnapshot }
  | { type: 'encode'; bytes: Uint8Array }
  | {
      /** 完整文字或含附件的只读备份生成，不持有目录权限。 */
      type: 'backup-export'
      /** 完整业务快照，包含全部正文和关联。 */
      snapshot: MobileSnapshot
      /** 未提供为 JSON，提供（包括空数组）为 ZIP；附件已在存储边界校验。 */
      files?: Array<{ name: string; bytes: Uint8Array }>
    }
  | {
      /** 只读海豹响应解析任务。 */
      type: 'sea-response'
      /** 原始响应 JSON，不含数据库或归档权限。 */
      text: string
      /** 原场次来源网址；可选，不进行网络访问。 */
      sourceUrl?: string
    }

// 上传字节仅留在工作线程；每次按需传一段，不集中复制 Base64 数组到界面。
let upload: { id: string; bytes: Uint8Array } | undefined
let preparing: object | undefined
let uploadSequence = 0
let tableLease:
  { id: string; revision: number; baseline: MobileSnapshot; candidate: MobileSnapshot } | undefined
let tableGeneration = 0

/**
 * 运行只读文件任务，保留既有大小/结构/ZIP/关联校验。
 * @param job - 明确的解码、校验或编码请求。
 * @returns 校验预览、编码文本、完整海豹正文或校验后的快照与 JSON，或待上传字节的私有租约/分段。
 */
export async function performSnapshotJob(job: SnapshotJob) {
  if (job.type === 'prepare-fetch-upload') {
    const token = {}
    preparing = token
    upload = undefined
    if (job.record.sourceType !== 'online' || !job.record.link) throw new Error('检测目标来源无效。')
    let record = job.record
    if (job.text !== undefined) {
      try {
        record = withFetchedLog(record, await decodeSeaResponse(job.text, record.link))
      } catch {
        record = withParseFailure(record)
      }
    }
    if (preparing !== token) throw new Error('上传准备已失效。')
    // 复用同一完整校验和编码路径；仅省去正文往返主线程的结构化复制。
    const prepared = await (
      performSnapshotJob as (
        value: SnapshotJob
      ) => Promise<Omit<FetchUpload, 'record'> & { snapshot: MobileSnapshot }>
    )({
      type: 'prepare-upload',
      snapshot: { ...job.snapshot, records: [record] }
    })
    const { snapshot: checked, ...lease } = prepared
    const { rawContent, manualContent, ...metadata } = record
    return { ...lease, record: metadata } satisfies FetchUpload
  }
  if (job.type === 'table-release') {
    if (tableLease?.id === job.id) tableLease = undefined
    return
  }
  if (job.type === 'table-import') {
    const generation = ++tableGeneration
    tableLease = undefined
    const baseline = structuredClone(job.snapshot)
    const result = await importTable(baseline, decodeBase64(job.base64), job.name, job.kind)
    if (job.revision === undefined) return result
    if (!Number.isSafeInteger(job.revision) || job.revision < 0 || generation !== tableGeneration)
      throw new Error('表格预览已失效。')
    const id = crypto.randomUUID()
    tableLease = { id, revision: job.revision, baseline, candidate: structuredClone(result.next) }
    return { ...result, lease: id }
  }
  if (job.type === 'table-confirm') {
    const lease = tableLease
    if (!lease || lease.id !== job.id || lease.revision !== job.revision)
      throw new Error('表格预览已失效，请重新选择表格。')
    const prepared = (await performSnapshotJob({
      type: 'prepare',
      snapshot: lease.candidate,
      measure: job.measure
    })) as { snapshot: MobileSnapshot; json: string; timing?: TablePhaseTiming }
    const started = performance.now()
    const delta = createTableDelta(lease.baseline, prepared.snapshot)
    const json = JSON.stringify(delta)
    if (new TextEncoder().encode(json).length > capacity.tableRequestBytes)
      throw new Error('表格差量超过 64 MiB。')
    if (tableLease !== lease) throw new Error('表格预览已失效。')
    if (prepared.timing) {
      const elapsed = performance.now() - started
      prepared.timing.phasesMs.deltaEncode = elapsed
      prepared.timing.totalMs += elapsed
    }
    return { ...prepared, json }
  }
  if (job.type === 'upload-close') {
    if (upload?.id === job.id) upload = undefined
    return
  }
  if (job.type === 'upload-chunk') {
    if (
      !upload ||
      upload.id !== job.id ||
      !Number.isSafeInteger(job.index) ||
      job.index < 0 ||
      job.index * capacity.transferChunkBytes >= upload.bytes.length
    )
      throw new Error('上传分段已失效。')
    return encodeBase64(
      upload.bytes.subarray(
        job.index * capacity.transferChunkBytes,
        (job.index + 1) * capacity.transferChunkBytes
      )
    )
  }
  const token = job.type === 'prepare-upload' ? {} : undefined
  if (token) {
    preparing = token
    upload = undefined
  }
  if (job.type === 'read-local') return (await validateSnapshotBytes(await readSource(job.source))).snapshot
  if (job.type === 'backup-export')
    return job.files ? encodeArchiveBackup(job.snapshot, job.files) : encodeBackup(job.snapshot)
  if (job.type === 'sea-response') return decodeSeaResponse(job.text, job.sourceUrl)
  if (job.type === 'preview') return previewBackup(job.bytes)
  if (job.type === 'preview-base64') return previewBackup(decodeBase64(job.base64))
  if (job.type === 'read') return validateSnapshotBytes(new TextEncoder().encode(job.json))
  if (job.type === 'checked-json') {
    const checked = await validateSnapshotBytes(new TextEncoder().encode(job.json))
    return JSON.stringify(checked.snapshot)
  }
  if (job.type === 'encode') return encodeBase64(job.bytes)
  if (job.type === 'serialize') return JSON.stringify(job.snapshot)
  // Timing is opt-in and cannot bypass or change any validation. No values/IDs are recorded.
  const started = job.type === 'prepare' && job.measure === true ? performance.now() : undefined
  let previous = started
  const phasesMs: Record<string, number> = {}
  const mark = (name: string) => {
    if (previous === undefined) return
    const now = performance.now()
    phasesMs[name] = now - previous
    previous = now
  }
  const input = JSON.stringify(job.snapshot)
  mark('inputJson')
  const inputBytes = encodeUtf8(input)
  mark('utf8Encode')
  const snapshot = (await validateSnapshotBytes(inputBytes)).snapshot
  mark('decodeParseValidate')
  const json = JSON.stringify(snapshot)
  mark('outputJson')
  if (job.type === 'prepare-upload') {
    const bytes = encodeUtf8(json)
    if (bytes.length > capacity.snapshotUploadBytes) throw new Error('待保存数据超过 64 MiB。')
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('')
    if (preparing !== token) throw new Error('上传准备已失效。')
    const id = String(++uploadSequence)
    upload = { id, bytes }
    return {
      snapshot,
      bytes: bytes.length,
      sha256,
      id,
      count: Math.ceil(bytes.length / capacity.transferChunkBytes)
    }
  }
  const timing: TablePhaseTiming | undefined =
    started === undefined
      ? undefined
      : { clock: 'worker-monotonic', totalMs: performance.now() - started, phasesMs }
  return { snapshot, json, ...(timing ? { timing } : {}) }
}
