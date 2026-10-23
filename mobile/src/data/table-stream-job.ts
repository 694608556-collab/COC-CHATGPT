import { readTableGridStream } from './table-grid-stream'
import { readLocalSourceStream } from './local-source-stream'
import type { LocalStreamSource } from './local-source-stream'
import { createImportSheetParser } from '../../../src/shared/table-import'
import { readWorkbookGrid } from '../../../src/shared/table-grid'
import type { GridSheet } from '../../../src/shared/table-grid'
import { detectCharacterSheets, importCharacterFromSheet } from '../../../src/shared/character-template'
import { capacity } from './capacity'
import { addStreamBytes, checkStreamBudget, checkStreamCancelled } from './stream-json'
import { StreamSha256 } from './stream-sha256'
import { parseSeaLogUrl } from './sea-parser'
import { previewCoc7Sheet } from './coc7-import'
import type { Coc7ImportPreview } from './coc7-import'
import type { WorkSheet, CellObject } from 'xlsx'
import { createVerifiedTableReplay } from './verified-table-source'
import type { Coc7WorksheetRequest, WorksheetCell } from './table-dom-worksheet'
import { readKernelRecordsGrid } from './table-kernel-records'
import type { RecordsKernelSource } from './table-kernel-records'
import { encodeUtf8 } from './bytes'

// An encoding crossover in UTF-16 code units, never a content or staging limit.
// Small records avoid per-row Blob/reader setup; larger rows keep every byte.
const candidateBlobThreshold = 16 * 1024
// Only queued UTF-16 text is bounded; oversized complete lines keep the full
// existing encoder. This never limits a row, input, candidate or staged file.
const candidateTextBudget = 256 * 1024

export interface TableStreamJob {
  source: LocalStreamSource
  name: string
  format: 'csv' | 'xlsx' | 'xls'
  kind: 'records' | 'characters' | 'coc7'
  maximumStageBytes: number
  /** Opt-in numeric milliseconds only; diagnostics remain inside measured work. */
  measure?: boolean
  recordsKernel?: RecordsKernelSource
}
/** Mutually exclusive complete draft/candidate results with optional numeric diagnostics. */
type TableStreamResult = (
  | { draft: Coc7ImportPreview; candidate?: never; candidates?: never }
  | { draft?: never; candidate: { bytes: number; sha256: string }; candidates: number }
) & { timing?: Record<string, number> }

/** Writes only a native-owned private candidate; never writes production data.
 * @param job Complete source credentials, parsing mode and optional diagnostics.
 * @param write Acknowledged private staging writer; its wait remains inside timing.
 * @param readString Complete spilled shared-string reader.
 * @param signal Cancellation signal; cancellation never returns a successful result.
 * @param projectWorksheet Optional existing character worksheet projection.
 * @returns A complete draft or candidate proof, plus numeric milliseconds only when requested.
 */
export async function performTableStreamJob(
  job: TableStreamJob,
  write: (key: 'candidate' | 'strings', chunk: Uint8Array) => Promise<void>,
  readString: (index: number) => Promise<string>,
  signal?: AbortSignal,
  projectWorksheet?: (request: Coc7WorksheetRequest) => Promise<WorksheetCell[] | undefined>
): Promise<TableStreamResult> {
  const jobStart = performance.now(),
    timing: Record<string, number> = {}
  const measureRecords = job.measure === true && job.kind === 'records'
  checkStreamBudget(job.maximumStageBytes)
  const digest = new StreamSha256(),
    encoder = new TextEncoder()
  const nativeDigest = job.kind === 'records' ? globalThis.crypto?.subtle : undefined
  // A temporary encoding/hash budget, never an input limit. Overflow or an
  // unavailable accelerator uses the same complete incremental digest.
  const nativeDigestBudget = 2 * 1024 * 1024
  let digestChunks: Uint8Array<ArrayBuffer>[] | undefined =
    typeof nativeDigest?.digest === 'function' ? [] : undefined
  let digestBytes = 0
  let staged = 0,
    candidates = 0,
    order = 0
  let parser: ReturnType<typeof createImportSheetParser> | undefined
  let sheet: GridSheet | undefined
  let cardSheet: WorkSheet | undefined, draft: Coc7ImportPreview | undefined
  if (job.kind === 'coc7' && job.format !== 'xlsx') throw new Error('请选择七版角色卡的 XLSX 文件。')
  const buffers = {
    candidate: new Uint8Array(capacity.transferChunkBytes),
    strings: new Uint8Array(capacity.transferChunkBytes)
  }
  const used = { candidate: 0, strings: 0 }
  // These are cache budgets, never import limits. Larger inputs and evicted
  // strings keep using the same fully validated native disk staging path.
  const cacheBudget = 2 * 1024 * 1024
  const stringCache = new Map<number, string>()
  let cachedStringBytes = 0
  let cachedSource: Uint8Array[] | undefined
  let stringsOnDisk = false,
    nextStringIndex = 0
  /** Retains recent decoded values within a conservative UTF-16/entry budget.
   * @param index Private append-only string index. @param value Complete decoded value.
   * @returns No value; oversized values remain available from native staging.
   */
  function rememberString(index: number, value: string) {
    const bytes = value.length * 2 + 64
    if (bytes > cacheBudget) return
    const previous = stringCache.get(index)
    if (previous !== undefined) {
      cachedStringBytes -= previous.length * 2 + 64
      stringCache.delete(index)
    }
    while (cachedStringBytes + bytes > cacheBudget) {
      const oldest = stringCache.keys().next().value!
      cachedStringBytes -= stringCache.get(oldest)!.length * 2 + 64
      stringCache.delete(oldest)
    }
    stringCache.set(index, value)
    cachedStringBytes += bytes
  }
  /** Hash the exact borrowed buffer before it can be reused by a later row.
   * @param chunk Complete current candidate segment. @returns No value.
   */
  function updateCandidateDigest(chunk: Uint8Array) {
    const digestStart = measureRecords ? performance.now() : 0
    digestBytes = addStreamBytes(digestBytes, chunk.length)
    if (digestChunks && digestBytes <= nativeDigestBudget) digestChunks.push(chunk.slice())
    else {
      if (digestChunks) {
        for (const previous of digestChunks) digest.update(previous)
        digestChunks = undefined
      }
      digest.update(chunk)
    }
    if (measureRecords)
      timing.jsDigestUpdateMs = (timing.jsDigestUpdateMs ?? 0) + performance.now() - digestStart
  }
  /** Prove every acknowledged byte, with exact streaming fallback on failure.
   * @returns The complete candidate length and lowercase SHA-256.
   */
  async function finishCandidateDigest() {
    const started = measureRecords ? performance.now() : 0
    let sha256: string | undefined
    if (digestChunks) {
      try {
        const complete = new Uint8Array(digestBytes)
        let offset = 0
        for (const chunk of digestChunks) {
          complete.set(chunk, offset)
          offset += chunk.length
        }
        const hash = new Uint8Array(await nativeDigest!.digest('SHA-256', complete.buffer))
        if (hash.length !== 32) throw Error('Native candidate digest length is invalid')
        sha256 = Array.from(hash, (value) => value.toString(16).padStart(2, '0')).join('')
      } catch {
        // The accelerator owns no authority. The retained immutable chunks
        // permit a fresh full proof; failure never substitutes an empty hash.
        for (const chunk of digestChunks) digest.update(chunk)
      } finally {
        digestChunks = undefined
      }
    }
    if (sha256 === undefined) {
      if (digest.bytes !== digestBytes) throw Error('Candidate digest byte count is incomplete')
      sha256 = digest.digest()
    }
    if (measureRecords) timing.jsDigestFinalizeMs = performance.now() - started
    checkStreamCancelled(signal)
    return { bytes: digestBytes, sha256 }
  }
  let candidateWrite: Promise<void> | undefined
  let candidateWriteFailure: { error: unknown } | undefined
  /** Settle the sole owned candidate buffer before reuse, success or failure.
   * @returns No value; the original append error is propagated after ACK settles.
   */
  async function settleCandidateWrite() {
    if (candidateWrite) {
      await candidateWrite
      candidateWrite = undefined
    }
    if (candidateWriteFailure) throw candidateWriteFailure.error
  }
  async function flush(key: 'candidate' | 'strings') {
    if (!used[key]) return
    checkStreamCancelled(signal)
    const chunk = buffers[key].subarray(0, used[key])
    const writeStart = measureRecords ? performance.now() : 0
    if (key === 'candidate' && job.kind === 'records') {
      await settleCandidateWrite()
      checkStreamCancelled(signal)
      // One extra transfer-sized owned buffer is a bounded pipeline budget,
      // never a content limit. Later rows may fill the working buffer while
      // this immutable copy awaits ACK; the next dispatch first settles it.
      const owned = chunk.slice()
      const dispatched = measureRecords ? performance.now() : 0
      candidateWrite = write(key, owned).then(
        () => {
          if (measureRecords)
            timing.jsAwaitWriteMs = (timing.jsAwaitWriteMs ?? 0) + performance.now() - dispatched
        },
        (error) => {
          candidateWriteFailure = { error }
          if (measureRecords)
            timing.jsAwaitWriteMs = (timing.jsAwaitWriteMs ?? 0) + performance.now() - dispatched
        }
      )
      try {
        updateCandidateDigest(owned)
      } catch (error) {
        await settleCandidateWrite()
        throw error
      }
      used[key] = 0
      return
    } else {
      await write(key, chunk)
      if (key === 'candidate') updateCandidateDigest(chunk)
    }
    if (measureRecords) timing.jsAwaitWriteMs = (timing.jsAwaitWriteMs ?? 0) + performance.now() - writeStart
    used[key] = 0
  }
  async function sendEncoded(key: 'candidate' | 'strings', text: string) {
    checkStreamCancelled(signal)
    const encodeStart = measureRecords && key === 'candidate' ? performance.now() : 0
    const bytes =
      job.kind === 'records' && key === 'candidate' && text.length >= candidateBlobThreshold
        ? encodeUtf8(text)
        : encoder.encode(text)
    if (measureRecords && key === 'candidate')
      timing.jsCandidateUtf8Ms = (timing.jsCandidateUtf8Ms ?? 0) + performance.now() - encodeStart
    if (addStreamBytes(staged, bytes.length) > job.maximumStageBytes)
      throw new Error('表格暂存所需空间超过手机本次可用空间。')
    staged = addStreamBytes(staged, bytes.length)
    for (let offset = 0; offset < bytes.length;) {
      checkStreamCancelled(signal)
      const count = Math.min(bytes.length - offset, capacity.transferChunkBytes - used[key])
      buffers[key].set(bytes.subarray(offset, offset + count), used[key])
      used[key] += count
      offset += count
      if (used[key] === capacity.transferChunkBytes) await flush(key)
    }
  }
  let pendingCandidateText: string[] = [],
    pendingCandidateUnits = 0
  /** Encode whole queued lines together; no surrogate pair is split or altered.
   * @returns Resolves after every resulting byte entered the original bounded writer.
   */
  async function flushCandidateText() {
    if (!pendingCandidateText.length) return
    checkStreamCancelled(signal)
    const text = pendingCandidateText.join('')
    pendingCandidateText = []
    pendingCandidateUnits = 0
    await sendEncoded('candidate', text)
  }
  /** Keep only a bounded queue of complete records lines, preserving input order.
   * @param key Existing independent candidate/string sink. @param text Complete line.
   * @returns Resolves when accepted into bounded memory or the original encoder.
   */
  async function send(key: 'candidate' | 'strings', text: string) {
    checkStreamCancelled(signal)
    if (job.kind === 'records' && key === 'candidate') {
      if (text.length <= candidateTextBudget) {
        if (pendingCandidateUnits + text.length > candidateTextBudget) await flushCandidateText()
        pendingCandidateText.push(text)
        pendingCandidateUnits += text.length
        return
      }
      await flushCandidateText()
    }
    await sendEncoded(key, text)
  }
  const start = (info: { name: string; order: number; mergedRanges?: string[] }) => {
    checkStreamCancelled(signal)
    order = info.order
    parser = createImportSheetParser(info.name)
    sheet = { name: info.name, rows: [], mergedRanges: info.mergedRanges ?? [] }
    cardSheet = job.kind === 'coc7' && info.name === '人物卡' ? {} : undefined
  }
  const row = (value: { index: number; values: Array<string | number | boolean | null> }) => {
    checkStreamCancelled(signal)
    if (!sheet || !parser || !Number.isSafeInteger(value.index) || value.index < 0)
      throw new Error('表格行坐标无效。')
    if (job.kind === 'coc7') return
    if (job.kind === 'characters') {
      sheet.rows[value.index] = value.values
      return
    }
    const parsed = parser(value.values)
    if (!parsed) return
    if (!parsed.moduleName) throw new Error(parsed.sheet + ' 缺少模组名，请补齐后重新导入。')
    if (parsed.link) parseSeaLogUrl(parsed.link)
    const jsonStart = measureRecords ? performance.now() : 0
    const text = 'T' + JSON.stringify({ sheetOrder: order, rowOrder: value.index, value: parsed }) + '\n'
    if (measureRecords)
      timing.jsCandidateJsonMs = (timing.jsCandidateJsonMs ?? 0) + performance.now() - jsonStart
    return send('candidate', text).then(() => {
      candidates++
    })
  }
  const end = async () => {
    if (cardSheet) draft = previewCoc7Sheet(cardSheet)
    if (job.kind === 'characters' && sheet) {
      for (const found of detectCharacterSheets({ sheets: [sheet] })) {
        if (!Object.keys(found.mapping).length) continue
        const card = importCharacterFromSheet(
          sheet,
          found.edition,
          found.mapping,
          undefined,
          found.skillHeaderRow
        )
        if (!card.basic.name) card.basic.name = found.sheetName
        await send(
          'candidate',
          'C' +
            JSON.stringify({
              sheetOrder: order,
              rowOrder: 0,
              value: card,
              warnings: found.warnings.map((w) => found.sheetName + '：' + w)
            }) +
            '\n'
        )
        candidates++
      }
    }
    sheet = undefined
    parser = undefined
  }
  /** Replays a small proven private source without repeated WKURLSchemeHandler requests.
   * @returns Complete bounded chunks; EOF and SHA-256 must succeed before reuse.
   */
  async function* source(): AsyncGenerator<Uint8Array> {
    if (cachedSource) {
      for (const chunk of cachedSource) {
        checkStreamCancelled(signal)
        yield chunk
      }
      return
    }
    const cache: Uint8Array[] | undefined = job.source.bytes <= cacheBudget ? [] : undefined
    for await (const chunk of readLocalSourceStream(job.source, { maximumBytes: job.source.bytes, signal })) {
      cache?.push(chunk.slice())
      yield chunk
    }
    cachedSource = cache
  }
  try {
    const replayStart = measureRecords ? performance.now() : 0
    const kernelRead =
      job.kind === 'records' && job.format === 'xlsx' && job.recordsKernel
        ? await readKernelRecordsGrid(
            job.recordsKernel,
            job.source,
            { onSheetStart: start, onRow: row, onSheetEnd: end },
            signal
          )
        : false
    if (kernelRead) {
      // Inclusive replay time includes candidate encoding and any writes it awaits;
      // diagnostics must not be summed or subtracted from end-to-end latency.
      if (measureRecords) timing.jsRecordsReplayMs = performance.now() - replayStart
    } else if (job.format === 'xls') {
      // Legacy BIFF/content-detected formats keep the existing parser compatibility.
      // No product file-size cap; allocation is limited by the actual JS/OS memory.
      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(job.source.bytes)
      } catch {
        throw new Error('当前运行内存不足以读取旧版 XLS，请转换为 XLSX 或 CSV 后重试。')
      }
      let offset = 0
      for await (const chunk of source()) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      if (offset !== bytes.length) throw new Error('表格来源未完整读取。')
      const workbook = readWorkbookGrid(bytes, job.name)
      for (const [index, current] of workbook.sheets.entries()) {
        await start({ name: current.name, order: index, mergedRanges: current.mergedRanges })
        for (const key of Object.keys(current.rows)) {
          const rowIndex = Number(key)
          await row({ index: rowIndex, values: current.rows[rowIndex]! })
        }
        await end()
      }
    } else {
      const replay =
        job.source.bytes <= cacheBudget ? await createVerifiedTableReplay(job.source, signal) : source
      if (job.measure) timing.sourceReadAndProof = performance.now() - jobStart
      await readTableGridStream({
        name: job.name,
        format: job.format,
        source: replay,
        expectedSource: { bytes: job.source.bytes, sha256: job.source.sha256 },
        maximumExpandedBytes: job.maximumStageBytes,
        collectMergedRanges: job.kind !== 'coc7',
        coc7Projection:
          job.kind === 'coc7' && projectWorksheet
            ? {
                canUse: () => !stringsOnDisk,
                async run(request) {
                  const start = performance.now()
                  const result = await projectWorksheet(request)
                  if (job.measure) {
                    timing.domCalls = (timing.domCalls ?? 0) + 1
                    timing.domFallbacks = (timing.domFallbacks ?? 0) + (result ? 0 : 1)
                    timing.domMilliseconds = (timing.domMilliseconds ?? 0) + performance.now() - start
                  }
                  return result
                }
              }
            : undefined,
        measurePhase: job.measure
          ? (name, milliseconds) => {
              timing[name] = milliseconds
            }
          : undefined,
        measureWork: job.measure
          ? (name, milliseconds) => {
              timing[name] = (timing[name] ?? 0) + milliseconds
            }
          : undefined,
        wantsCellDetails: (sheet) => job.kind === 'coc7' && sheet === '人物卡',
        signal,
        writeString: async (index, value) => {
          if (index !== nextStringIndex++) throw new Error('共享字符串索引乱序。')
          if (!stringsOnDisk && cachedStringBytes + value.length * 2 + 64 > cacheBudget) {
            // Until the first eviction, every complete value is still resident.
            // Persist that exact prefix in index order before enabling eviction;
            // larger workbooks retain the existing complete disk-backed path.
            stringsOnDisk = true
            for (const [previous, text] of [...stringCache].sort((a, b) => a[0] - b[0]))
              await send('strings', JSON.stringify([previous, text]) + '\n')
          }
          rememberString(index, value)
          if (stringsOnDisk) await send('strings', JSON.stringify([index, value]) + '\n')
        },
        readString: (index) => {
          const cached = stringCache.get(index)
          if (cached !== undefined) {
            rememberString(index, cached)
            return cached
          }
          if (!stringsOnDisk) throw new Error('共享字符串索引缺失。')
          return (async () => {
            await flush('strings')
            const value = await readString(index)
            rememberString(index, value)
            return value
          })()
        },
        onCell: (cell) => {
          // The existing single-character template reads only rows 1–95. Keep
          // saved error/formula metadata so validation matches the old importer.
          if (!cardSheet || Number(cell.address.match(/\d+$/)?.[0]) > 95) return
          cardSheet[cell.address] = {
            t: cell.type as CellObject['t'],
            ...(cell.value === undefined ? {} : { v: cell.value }),
            ...(cell.hasFormula ? { f: cell.formula || 'SAVED_FORMULA' } : {})
          }
        },
        onSheetStart: start,
        onRow: row,
        onSheetEnd: end
      })
    }
    if (job.kind === 'coc7') {
      if (!draft) throw new Error('文件中没有“人物卡”工作表。')
      await flush('strings')
      checkStreamCancelled(signal)
      return { draft, ...(job.measure ? { timing: { ...timing, total: performance.now() - jobStart } } : {}) }
    }
    if (!candidates) throw new Error('没有可新增的有效数据。')
    await flushCandidateText()
    await flush('strings')
    await flush('candidate')
    await settleCandidateWrite()
    checkStreamCancelled(signal)
    const candidate = await finishCandidateDigest()
    return {
      candidate,
      candidates,
      ...(measureRecords ? { timing: { ...timing, jsTotalMs: performance.now() - jobStart } } : {})
    }
  } finally {
    // A later parse/cancellation failure cannot release its native owner while
    // an already-dispatched append still owns a borrowed buffer.
    await settleCandidateWrite()
  }
}
