import type { LocalStreamSource } from './local-source-stream'
import type { StreamReadOptions, StreamBackupPreview, StreamProof } from './backup-stream'
import { recordMetadata } from './backup-stream'
import { readSource } from './local-source'
import { validateOverviewBytes, validateBackupRecord } from './backup'
import { validateReadOnlySearchRecord } from './search-record-validation'
import { checkStreamBudget, checkStreamCancelled } from './stream-json'
import type { SessionRecord, FilterPreset } from '../../../src/shared/types'
import { projectSearchTuples, type SearchMessageText } from './search-projection-messages'

/** Shared semantic gates for whole-file and incrementally sealed search sources. */
export interface SearchProjectionReadOptions extends StreamReadOptions {
  searchProjectionVersion?: 1 | 2 | 3
  preset?: FilterPreset
  /** Bodyless metadata and all rendered messages; never a restore candidate. */
  stageProjection?(record: SessionRecord, messages: SearchMessageText[]): Promise<void>
}

/** Native projection envelope; metadata still receives full graph validation. */
export interface SearchProjectionRoot {
  format: 'coc.logbook.android'
  formatVersion: 1
  snapshot: Record<string, unknown> & { records: unknown[] }
}

/** Read a native-owned grammar-validated disposable source; this has no write authority.
 * @param source The exact sealed local projection credential.
 * @param options Full record, graph, cancellation and byte-proof checks.
 * @returns The same bodyless preview as the complete search reader.
 */
export async function readSearchProjection(
  source: LocalStreamSource,
  options: SearchProjectionReadOptions
): Promise<StreamBackupPreview> {
  checkStreamBudget(options.maximumBytes)
  checkStreamCancelled(options.signal)
  if (
    source.bytes > options.maximumBytes ||
    (options.expectedSource &&
      (source.bytes !== options.expectedSource.bytes || source.sha256 !== options.expectedSource.sha256))
  )
    throw new Error('完整搜索投影证明不符。')
  const started = options.measurePhase ? performance.now() : 0
  const bytes = await readSource(source)
  options.measurePhase?.('projectionReadProofMs', performance.now() - started)
  checkStreamCancelled(options.signal)
  const parseStarted = options.measurePhase ? performance.now() : 0
  const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  options.measurePhase?.('projectionJsonParseMs', performance.now() - parseStarted)
  // Grammar/escaped-duplicate checking happened over every original byte in
  // native code. This reader is admitted only for that exact native lease;
  // Version 3 also validates all original message/image semantics before
  // projection. Here metadata, graph, source association, tuple fields and the
  // sealed projection SHA remain checked independently; nothing can be written.
  validateSearchProjectionRoot(input)
  options.measurePhase?.('strictRecordParseMs', performance.now() - started)
  const collector = createSearchProjectionCollector(options)
  for (const value of input.snapshot.records) await collector.stage(value)
  return collector.finish(input, source)
}

/** Validate the complete root shape before any records are staged.
 * @param input Parsed sealed root or complete projection envelope.
 * @returns No value; malformed envelopes throw before processing any record.
 */
export function validateSearchProjectionRoot(input: unknown): asserts input is SearchProjectionRoot {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !('format' in input) ||
    input.format !== 'coc.logbook.android' ||
    !('formatVersion' in input) ||
    input.formatVersion !== 1 ||
    !('snapshot' in input) ||
    !input.snapshot ||
    typeof input.snapshot !== 'object' ||
    Array.isArray(input.snapshot) ||
    !('records' in input.snapshot) ||
    !Array.isArray(input.snapshot.records) ||
    Object.prototype.hasOwnProperty.call(input, 'records')
  )
    throw new Error('正文搜索投影结构无效。')
}

/** Apply exactly the same per-record and final graph validation to either transport.
 * @param options Full semantic gates and private staging callbacks.
 * @returns An unpublished record collector; finish validates the entire metadata graph.
 */
export function createSearchProjectionCollector(options: SearchProjectionReadOptions) {
  const records: SessionRecord[] = []
  let offlineRecords = 0
  /** @param value One complete native record. @returns Private staging only, never publication. */
  async function stage(value: unknown): Promise<void> {
    checkStreamCancelled(options.signal)
    const validationStarted = options.measurePhase ? performance.now() : 0
    if (options.searchProjectionVersion === 3) {
      if (
        !options.stageProjection ||
        !options.preset ||
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value)
      )
        throw new Error('正文搜索投影消费者无效。')
      const { rawContent, ...metadata } = value as Record<string, any>
      const record = validateBackupRecord(metadata)
      if (rawContent === undefined) {
        await options.stageRecord(record, records.length)
        if (record.sourceType === 'manual' && record.manualContent) offlineRecords++
      } else {
        if (
          !rawContent ||
          typeof rawContent !== 'object' ||
          Array.isArray(rawContent) ||
          !Number.isFinite(rawContent.parserVersion) ||
          ['title', 'sourceUrl', 'responseHash'].some(
            (key) => rawContent[key] !== undefined && typeof rawContent[key] !== 'string'
          )
        )
          throw new Error('正文搜索投影日志字段无效。')
        if (
          record.sourceType === 'online' &&
          ((record.cacheSourceUrl && record.cacheSourceUrl !== record.link) ||
            (rawContent.sourceUrl && rawContent.sourceUrl !== record.link))
        )
          throw new Error('正文来源与场次链接不匹配。')
        const messages = projectSearchTuples(rawContent.messages, options.preset)
        options.measurePhase?.('recordValidationMs', performance.now() - validationStarted)
        await options.stageProjection(record, messages)
        offlineRecords++
      }
      records.push(recordMetadata(record))
      return
    }
    if (options.searchProjectionVersion === 2) expandSearchMessages(value)
    const record = validateReadOnlySearchRecord(value)
    options.measurePhase?.('recordValidationMs', performance.now() - validationStarted)
    await options.stageRecord(record, records.length)
    records.push(recordMetadata(record))
    if (record.rawContent || (record.sourceType === 'manual' && record.manualContent)) offlineRecords++
  }
  /** @param input Validated root envelope. @param source Complete projection proof.
   * @returns Full bodyless graph preview after all staged records have been checked.
   */
  async function finish(input: SearchProjectionRoot, source: StreamProof): Promise<StreamBackupPreview> {
    checkStreamCancelled(options.signal)
    const finalStarted = options.measurePhase ? performance.now() : 0
    const root = { ...input.snapshot, records }
    const checked = await validateOverviewBytes(
      new TextEncoder().encode(JSON.stringify({ ...input, snapshot: root }))
    )
    const warnings = checked.warnings.filter((message) => !message.includes('个场次未带正文'))
    if (offlineRecords < records.length)
      warnings.push(`${records.length - offlineRecords} 个场次未带正文，导入后不能凭链接离线阅读。`)
    checkStreamCancelled(options.signal)
    options.measurePhase?.('finalSourceGraphMs', performance.now() - finalStarted)
    return {
      metadata: { ...checked.snapshot, records: checked.snapshot.records.map(recordMetadata) },
      offlineRecords,
      source: { bytes: source.bytes, sha256: source.sha256 },
      warnings,
      archive: { integrity: [], attachments: [] }
    }
  }
  return { stage, finish }
}

const messageFields = [
  'id',
  'order',
  'timestamp',
  'displayName',
  'platformAccount',
  'text',
  'type',
  'isDiceCommand',
  'isOffTopic',
  'images'
] as const
/** Reconstruct only known message fields from the native presence-bound tuples.
 * @param record One private parsed projection record. @returns No value; invalid tuples abort all results.
 */
function expandSearchMessages(record: unknown): void {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return
  const log = (record as Record<string, any>).rawContent
  if (!log || typeof log !== 'object' || !Array.isArray(log.messages)) return
  log.messages = log.messages.map((tuple: unknown) => {
    if (
      !Array.isArray(tuple) ||
      tuple.length !== 11 ||
      !Number.isSafeInteger(tuple[0]) ||
      tuple[0] < 0 ||
      tuple[0] > 1023
    )
      throw new Error('正文搜索投影消息结构无效。')
    const message: Record<string, unknown> = {}
    for (let i = 0; i < messageFields.length; i++)
      if (tuple[0] & (1 << i)) message[messageFields[i]!] = tuple[i + 1]
    return message
  })
}
