import { capacity } from './capacity'
import {
  previewBackup,
  validateSnapshotBytes,
  validateSnapshotValue,
  validateOverviewBytes,
  encodeBackup,
  encodeArchiveBackup
} from './backup'
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
import { packUploadBytes } from './upload-transfer'
import type { UploadTransferChunk } from './upload-transfer'

/** 工作线程内已完整校验的上传租约；正文只保留在所属会话中。 */
export interface FetchUpload {
  /** 不带正文的场次元数据，仅在原生暂存成功后发布进度。 */
  record: SessionRecord
  /** 当前唯一上传租约标识。 */
  id: string
  /** 完整 UTF-8 字节数，必须可精确计量。 */
  bytes: number
  /** 完整字节 SHA-256。 */
  sha256: string
  /** 有序传输段数量；每段桥接字节最多 256KiB，解压窗口最多 2MiB。 */
  count: number
  /** true 或缺失代表仍持有原始字节；false 时租约只保留独立压缩字节。 */
  keepsOriginalBytes?: boolean
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
  | { type: 'read-overview'; json: string }
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
      /** 原生支持时使用无损传输；正文总长、完整摘要及业务校验保持相同。 */
      losslessTransfer?: boolean
    }
  | { type: 'read-local'; source: ExportSource }
  | { type: 'upload-chunk'; id: string; index: number }
  | { type: 'upload-transfer'; id: string; index: number }
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

/** 创建独立的后台任务会话，供 Node 验证复现各 Worker 的租约隔离。
 * @returns 拥有独立上传、准备和表格租约的任务执行函数；不访问原生权限或数据库。
 */
export function createSnapshotJobSession() {
  // 上传字节仅留在工作线程；每次按需传一段，不集中复制 Base64 数组到界面。
  let upload:
    | ({ id: string } & (
        { kind: 'bytes'; bytes: Uint8Array } | { kind: 'transfer'; parts: UploadTransferChunk[] }
      ))
    | undefined
  let preparing: object | undefined
  let uploadSequence = 0
  let tableLease:
    { id: string; revision: number; baseline: MobileSnapshot; candidate: MobileSnapshot } | undefined
  let tableGeneration = 0

  /** 在当前会话保留完整上传字节，摘要完成后再次核对准备代次。
   * @param snapshot - 已通过原有完整校验的规范快照。
   * @param token - 当前准备所有权；异步摘要期间被替换时拒绝。
   * @param json - 可复用的同一规范快照序列化结果；未提供时在当前线程生成。
   * @param losslessTransfer - 原生支持时将同一完整字节打包为独立无损传输段。
   * @returns 同一完整快照及可按序读取的私有上传租约，不写原生数据。
   */
  async function retainUpload(
    snapshot: MobileSnapshot,
    token: object,
    json = JSON.stringify(snapshot),
    losslessTransfer = false
  ) {
    const bytes = encodeUtf8(json)
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('')
    if (preparing !== token) throw new Error('上传准备已失效。')
    const id = String(++uploadSequence)
    const parts = losslessTransfer ? packUploadBytes(bytes) : undefined
    upload = parts ? { id, kind: 'transfer', parts } : { id, kind: 'bytes', bytes }
    return {
      snapshot,
      bytes: bytes.length,
      sha256,
      id,
      count: parts ? parts.length : Math.ceil(bytes.length / capacity.transferChunkBytes),
      keepsOriginalBytes: !parts || parts.some((part) => part.encoding === 'identity')
    }
  }

  /**
   * 运行只读文件任务，保留既有大小/结构/ZIP/关联校验。
   * @param job - 明确的解码、校验或编码请求。
   * @returns 校验预览、编码文本、完整海豹正文或校验后的快照与 JSON，或待上传字节的私有租约/分段。
   */
  return async function performSnapshotJob(job: SnapshotJob) {
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
      // 网络正文已经严格 JSON 解码；仍逐字段、全文及关联校验，省去编码后立即解码的往返。
      const checkedSnapshot = (await validateSnapshotValue({ ...job.snapshot, records: [record] })).snapshot
      const prepared = await retainUpload(checkedSnapshot, token, undefined, job.losslessTransfer)
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
    if (job.type === 'upload-transfer') {
      if (
        !upload ||
        upload.id !== job.id ||
        upload.kind !== 'transfer' ||
        !Number.isSafeInteger(job.index) ||
        job.index < 0 ||
        job.index >= upload.parts.length
      )
        throw new Error('上传分段已失效。')
      const part = upload.parts[job.index]!
      return { encoding: part.encoding, rawBytes: part.rawBytes, base64: encodeBase64(part.bytes) }
    }
    if (job.type === 'upload-chunk') {
      if (
        !upload ||
        upload.kind !== 'bytes' ||
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
    if (job.type === 'read-overview') return validateOverviewBytes(new TextEncoder().encode(job.json))
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
      return retainUpload(snapshot, token!, json)
    }
    const timing: TablePhaseTiming | undefined =
      started === undefined
        ? undefined
        : { clock: 'worker-monotonic', totalMs: performance.now() - started, phasesMs }
    return { snapshot, json, ...(timing ? { timing } : {}) }
  }
}

/** 当前工作线程的默认会话；各 Worker 的模块状态彼此隔离。 */
export const performSnapshotJob = createSnapshotJobSession()
