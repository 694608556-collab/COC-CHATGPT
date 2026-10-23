import { Capacitor } from '@capacitor/core'
import { Native } from '../src/data/native'
import type { SavedDocument } from '../src/data/native'
import { characterDraftProofText } from './character-draft-proof'
import type { Coc7ImportPreview } from '../src/data/coc7-import'
import type { NativeTablePreview } from '../src/data/table-stream-native'
import { CandidateWitnessCapture } from './public-io-candidate-witness'
import { requirePrivateTableExpectation, verifyPrivateTableCandidate } from './private-table-proof'
import type { PrivateTableExpectation } from './private-table-proof'
import { mergeImportedParticipants } from '../../src/shared/table-import'
import type { TableImportRow } from '../../src/shared/table-import'
import type { ModuleRecord, SessionRecord } from '../../src/shared/types'
import { cancelImportFromBack } from './public-io-navigation'
import { publicIoTableOrder } from './public-io-table-order'

declare global {
  interface Window {
    __publicIoDocuments?: Record<string, SavedDocument>
    __publicIoConfig: {
      mode: string
      expectedCardName?: string
      expectedCardProof?: string
      localPrivateCard?: boolean
      localPrivateTable?: boolean
      expectedTableProof?: unknown
      publicIoTableFirst?: unknown
    }
    __publicIoSource: string
    __publicIoResult: unknown
    __publicIoStage: string
    __publicIoObserveDraft?: (draft: Coc7ImportPreview, timing?: Record<string, number>) => void
    __publicIoObserveEditor?: (milliseconds: number) => void
  }
}
const results: Array<{
  operation: string
  totalMs: number
  responseMs?: number
  workerTiming?: Record<string, number>
  searchSource?: Record<string, number | boolean>
  searchNativeTiming?: Record<string, number>
  nativeCalls: Array<{ method: string; milliseconds: number; enteredMs: number }>
}> = []
const published: SavedDocument[] = []
let confirmations: ReturnType<typeof setInterval> | undefined
let delayNextStageForCancellation = false
let delayedCancellationStage: Promise<void> | undefined
let calls: Array<{ method: string; milliseconds: number; enteredMs: number }> = []
let privateDraftProof: string | undefined
let privateWorkerTiming: Record<string, number> | undefined
let actionStarted = 0
let receivedTablePreview: NativeTablePreview | undefined
let tableSourceTiming: Record<string, number> | undefined
let tableWorkerTiming: Record<string, number> | undefined
const tableCandidateWitness = new CandidateWitnessCapture()
let tableCandidateProof: { bytes: number; sha256: string } | undefined
let tableSourceProof: { bytes: number; sha256: string } | undefined
let expectedPrivateTable: PrivateTableExpectation | undefined
let searchSourceNumbers: Record<string, number | boolean> | undefined
let searchWorkerTiming: Record<string, number> | undefined
let searchNativeTiming: Record<string, number> | undefined
if (['complete', 'baseline'].includes(window.__publicIoConfig.mode)) {
  const post = Worker.prototype.postMessage
  /** Measure the complete real Worker job, without logging credentials or bodies.
   * @param message Existing request. @param rest Original transfer arguments.
   * @returns The original postMessage result.
   */
  Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
    if (message?.type === 'start' && message.job?.type === 'search') {
      message = { ...message, job: { ...message.job, measureSearch: true } }
      searchWorkerTiming = undefined
      const observe = (event: MessageEvent) => {
        if (!['done', 'failed'].includes(event.data?.type)) return
        this.removeEventListener('message', observe)
        if (event.data.type === 'done' && event.data.result?.timing)
          searchWorkerTiming = Object.fromEntries(Object.entries(event.data.result.timing as Record<string, number>)
            .filter(([, value]) => Number.isFinite(value) && value >= 0))
      }
      this.addEventListener('message', observe)
    }
    return (post as any).call(this, message, ...rest)
  }
}
if (window.__publicIoConfig.localPrivateCard) {
  window.__publicIoObserveEditor = (milliseconds) => {
    privateWorkerTiming = {
      ...privateWorkerTiming,
      editorCommits: (privateWorkerTiming?.editorCommits ?? 0) + 1,
      editorCommitMs: (privateWorkerTiming?.editorCommitMs ?? 0) + milliseconds
    }
  }
  window.__publicIoObserveDraft = (draft, timing) => {
    privateWorkerTiming = { ...privateWorkerTiming, nativeKernel: 1, ...timing }
    const bytes = new TextEncoder().encode(characterDraftProofText(draft))
    void crypto.subtle.digest('SHA-256', bytes).then((result) => {
      privateDraftProof = Array.from(new Uint8Array(result), (value) =>
        value.toString(16).padStart(2, '0')
      ).join('')
    })
  }
  const post = Worker.prototype.postMessage
  Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
    if (message?.type === 'start' && message.job?.kind === 'coc7') {
      message = { ...message, job: { ...message.job, measure: true } }
      privateDraftProof = undefined
      privateWorkerTiming = undefined
      const observe = async (event: MessageEvent) => {
        if (!['done', 'failed'].includes(event.data?.type)) return
        this.removeEventListener('message', observe)
        if (event.data.type === 'done' && event.data.result?.draft) {
          privateWorkerTiming = event.data.result.timing
          const bytes = new TextEncoder().encode(characterDraftProofText(event.data.result.draft))
          privateDraftProof = Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
            (value) => value.toString(16).padStart(2, '0')
          ).join('')
        }
      }
      this.addEventListener('message', observe)
    }
    return (post as any).call(this, message, ...rest)
  }
}
if (['tables', 'private-table'].includes(window.__publicIoConfig.mode)) {
  const post = Worker.prototype.postMessage
  /** Request numeric records diagnostics through the actual Worker boundary.
   * @param message Existing worker request, with measure enabled only for records.
   * @param rest Original transfer/options arguments, forwarded unchanged.
   * @returns The original postMessage result; all observer work remains timed.
   */
  Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
    if (message?.type === 'start' && message.job?.kind === 'records') {
      message = { ...message, job: { ...message.job, measure: true } }
      tableWorkerTiming = undefined
      /** Capture numbers only; release this observer on both success and failure.
       * @param event Existing Worker completion event. @returns No value.
       */
      const observe = (event: MessageEvent) => {
        if (!['done', 'failed'].includes(event.data?.type)) return
        this.removeEventListener('message', observe)
        if (event.data.type === 'done' && event.data.result?.timing)
          tableWorkerTiming = Object.fromEntries(
            Object.entries(event.data.result.timing as Record<string, number>).filter(
              ([key, value]) => key.startsWith('js') && Number.isFinite(value) && value >= 0
            )
          )
      }
      this.addEventListener('message', observe)
    }
    return (post as any).call(this, message, ...rest)
  }
}
const cap = (
  window as unknown as {
    Capacitor: { nativePromise(plugin: string, method: string, options: unknown): Promise<unknown> }
  }
).Capacitor
const nativePromise = cap.nativePromise.bind(cap)
cap.nativePromise = async (plugin, method, options) => {
  if (plugin === 'Logbook' && method === 'createSearchSource')
    options = { ...(options as object), measureSearch: true }
  if (
    plugin === 'Logbook' &&
    ['tables', 'private-table', 'complete'].includes(window.__publicIoConfig.mode)
  ) {
    const value = options as { key?: string; base64?: string; candidate?: { bytes: number; sha256: string } }
    tableCandidateWitness.observe(method, value)
    if (method === 'finishTablePreview') {
      tableCandidateProof = value.candidate
      options = { ...value, measureImport: true }
    }
  }
  if (plugin === 'Logbook' && method === 'openBackup') {
    if (['tables', 'private-table', 'complete'].includes(window.__publicIoConfig.mode))
      options = { ...(options as object), measureImport: true }
    if (window.__publicIoConfig.localPrivateCard) {
      privateDraftProof = undefined
      privateWorkerTiming = undefined
      options = { ...(options as object), measureImport: true }
    }
    const selected =
      published.find((file) => file.name === window.__publicIoSource) ??
      window.__publicIoDocuments?.[window.__publicIoSource]
    if (Capacitor.getPlatform() === 'ios') {
      check(selected, 'Only registered public iOS fixtures may be selected')
      options = { ...(options as object), publicRestoreDocument: selected.uri }
    } else {
      ;(window as unknown as { PublicIoChoice: { select(name: string): void } }).PublicIoChoice.select(
        selected?.uri ?? window.__publicIoSource
      )
    }
  }
  const start = performance.now()
  const enteredAt = start - actionStarted
  try {
    const result = await nativePromise(plugin, method, options)
    if (plugin === 'Logbook' && method === 'createSearchSource') {
      const value = result as Record<string, any>
      searchNativeTiming = value.timing
      searchSourceNumbers = {
        version: value.searchProjectionVersion ?? 0, bytes: value.source?.bytes ?? 0,
        originalBytes: value.originalSource?.bytes ?? 0, cacheMemoryBytes: value.cacheMemoryBytes ?? 0,
        maximumReadBytes: value.maximumReadBytes ?? 0, memoryBytes: value.searchMemoryBytes ?? 0,
        processMemoryZero: value.searchProcessMemoryZero === true
      }
    }
    if (plugin === 'Logbook' && method === 'openBackup') {
      tableSourceTiming = (result as { tableSource?: { importTiming?: Record<string, number> } }).tableSource
        ?.importTiming
      const source = (result as { tableSource?: { bytes: number; sha256: string } }).tableSource
      tableSourceProof = source && { bytes: source.bytes, sha256: source.sha256 }
    }
    if (plugin === 'Logbook' && method === 'finishTablePreview')
      receivedTablePreview = result as NativeTablePreview
    if (plugin === 'Logbook' && method === 'openBackup' && window.__publicIoConfig.localPrivateCard) {
      const timing = (result as { tableSource?: { importTiming?: Record<string, number> } }).tableSource
        ?.importTiming
      if (timing) privateWorkerTiming = { ...timing, beforeNativeCallMs: enteredAt }
    }
    if (plugin === 'Logbook' && method === 'appendTableStage' && delayNextStageForCancellation) {
      delayNextStageForCancellation = false
      delayedCancellationStage = new Promise((resolve) => setTimeout(resolve, 1500))
      await delayedCancellationStage
    }
    if (
      plugin === 'Logbook' &&
      ['writeArchive', 'finishExportArchive', 'finishPdfArchive', 'finishBackupExport'].includes(method)
    )
      published.push(result as SavedDocument)
    if (plugin === 'Logbook' && method === 'automaticBackup')
      published.push((result as { document: SavedDocument }).document)
    return result
  } finally {
    if (plugin === 'Logbook')
      calls.push({ method, milliseconds: performance.now() - start, enteredMs: enteredAt })
  }
}
/** @param ok Public fixture invariant. @param message Failure reason without user data. @returns No value; throws on failure. */
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message)
}
/** @param predicate Observable UI completion. @param message Stage label. @returns Resolves with the first truthy result; timeout fails the test. */
async function waitFor<T>(predicate: () => T, message: string): Promise<NonNullable<T>> {
  const deadline = performance.now() + 120000
  for (;;) {
    const value = predicate()
    if (value) return value as NonNullable<T>
    const error = document.querySelector('[role="alert"]')?.textContent
    if (error)
      throw Error(
        window.__publicIoConfig.localPrivateTable
          ? 'Private table UI operation failed'
          : message + ': ' + error
      )
    if (performance.now() > deadline) throw Error('Timeout: ' + message)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
/** @param text Exact visible button text. @param scope Current page/dialog. @returns An enabled visible button. */
function button(text: string, scope: ParentNode = document): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text && !b.disabled && b.getClientRects().length > 0
  )
}
/** @param text Exact button text. @returns Resolves after clicking the actual UI control. */
async function click(text: string) {
  ;(await waitFor(() => button(text), text)).click()
  await new Promise((resolve) => setTimeout(resolve, 0))
}
/** @param field Actual controlled React input. @param value New text. @returns No value; emits a normal bubbling input event. */
function input(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
/** @param operation Public operation label. @param task Real UI operation and assertions. @returns Resolves after recording end-to-end and native elapsed times. */
async function timed(operation: string, task: () => Promise<void>) {
  window.__publicIoStage = operation
  calls = []
  let blocking = 0,
    progress = 0,
    redundantCancel = 0
  const importing = operation.includes('import-')
  const searching = operation.startsWith('module-search-')
  if (searching) searchWorkerTiming = undefined
  let responseMs: number | undefined,
    responseQueued = false
  const observer = new MutationObserver((mutations) => {
    if (!importing && !searching) return
    if (
      !responseQueued &&
      ((searching && !!document.querySelector('.module-body-search [role="status"]')) || mutations.some(
        (mutation) =>
          (mutation.type === 'attributes' &&
            mutation.target instanceof HTMLButtonElement &&
            mutation.target.disabled) ||
          (mutation.type === 'childList' && !!document.querySelector('.editor'))
      ))
    ) {
      responseQueued = true
      requestAnimationFrame(() => {
        responseMs = performance.now() - start
      })
    }
    blocking += document.querySelectorAll('[role="dialog"][aria-label="正在导入表格"]').length
    redundantCancel = Math.max(
      redundantCancel,
      Array.from(document.querySelectorAll('button')).filter(
        (button) => button.textContent?.trim() === '取消导入'
      ).length
    )
    progress = Math.max(progress, document.querySelectorAll('[role="progressbar"]').length)
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['disabled']
  })
  const start = performance.now()
  actionStarted = start
  try {
    await task()
    check(!blocking, 'Import must not flash a blocking validation dialog')
    check(progress <= 1, 'Import must not duplicate progress')
    check(redundantCancel === 0, 'Import must not add the removed trailing cancel button')
    const totalMs = performance.now() - start
    results.push({
      operation,
      totalMs,
      ...(importing || searching ? { responseMs: responseMs ?? totalMs } : {}),
      ...(searching ? { searchSource: searchSourceNumbers, searchNativeTiming, workerTiming: searchWorkerTiming } : {}),
      ...(operation.startsWith('character-import-xlsx') && privateWorkerTiming
        ? { workerTiming: privateWorkerTiming }
        : {}),
      nativeCalls: [...calls]
    })
  } finally {
    observer.disconnect()
  }
}

/** @param label Measured operation. @param action Actual enabled UI action. @param count Expected published files. @returns Newly published, native readback-proven files. */
async function saved(label: string, action: () => Promise<void>, count = 1) {
  const before = published.length
  await timed(label, async () => {
    await action()
    await waitFor(() => published.length === before + count, 'published ' + label)
    await waitFor(
      () =>
        !document.querySelector('.operation-feedback .busy-progress') &&
        !document.querySelector('[role="dialog"][aria-label="导出日志"]'),
      'finished ' + label
    )
  })
  const files = published.slice(before)
  check(
    files.every((file) => file.bytes > 0 && /^[a-f0-9]{64}$/.test(file.sha256)),
    'Every output needs complete byte/hash proof'
  )
  return files
}

/** @param label One supported export format label. @returns Resolves after selecting the real dropdown option and clicking save. */
async function chooseExport(label: string) {
  const dialog = await waitFor(
    () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="导出日志"]'),
    'export dialog'
  )
  dialog.querySelector<HTMLButtonElement>('[role="combobox"]')!.click()
  const option = await waitFor(
    () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(
        (item) => item.textContent?.replace('✓', '').trim() === label
      ),
    'format ' + label
  )
  option.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await click('保存导出文件')
}

/** Real packaged UI, fresh source/grant/revision on every preview. Cancel the
 * first eight previews, then commit all 115 rows once and verify every link
 * and the entire last manual body. Existing complete matrix stays intact. */
async function measureRecordTables(commit = true) {
  const privateMode = !!expectedPrivateTable
  const publicFormats = publicIoTableOrder(window.__publicIoConfig.publicIoTableFirst)
  const formats = privateMode ? ['xlsx'] : publicFormats
  const before = privateMode ? await Native.getOverview() : undefined
  let privateRows: TableImportRow[] | undefined
  await click('数据与设置')
  for (const extension of formats) {
    window.__publicIoSource = 'public-io-table.' + extension
    for (let repeat = 0; repeat < 3; repeat++) {
      receivedTablePreview = undefined
      tableSourceTiming = undefined
      tableWorkerTiming = undefined
      tableCandidateProof = undefined
      tableSourceProof = undefined
      await timed('record-table-import-preview-' + extension + '-' + repeat, async () => {
        await click('导入场次表格')
        await waitFor(
          () => document.querySelector('[role="dialog"][aria-label="表格导入预览"]'),
          'complete table preview'
        )
        check(
          receivedTablePreview?.added === (expectedPrivateTable?.rows ?? 115) &&
            receivedTablePreview.updated === 0 &&
            receivedTablePreview.skipped === 0 &&
            receivedTablePreview.namesCount === (expectedPrivateTable?.rows ?? 115),
          'Every preview must include every complete expected input row'
        )
      })
      // This independent readback happens after timing. It binds every format's
      // entire staged candidate to the proof actually accepted by native code.
      results[results.length - 1]!.workerTiming = {
        ...(tableSourceTiming as Record<string, number> | undefined),
        ...(receivedTablePreview as (NativeTablePreview & { timing?: Record<string, number> }) | undefined)
          ?.timing,
        ...tableWorkerTiming
      }
      const verificationStarted = performance.now()
      const bytes = tableCandidateWitness.read()
      results[results.length - 1]!.workerTiming!.witnessDecodeAfterPreviewMs =
        performance.now() - verificationStarted
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
        value.toString(16).padStart(2, '0')
      ).join('')
      const proof = tableCandidateProof as { bytes: number; sha256: string } | undefined
      check(
        proof?.bytes === bytes.length && proof.sha256 === hash,
        'Every complete staged candidate matches the accepted native proof'
      )
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      check(text.endsWith('\n'), 'Complete final candidate line is present')
      if (privateMode) {
        privateRows = await verifyPrivateTableCandidate(expectedPrivateTable, tableSourceProof, proof, bytes)
        const names = privateTableNames(privateRows)
        for (let offset = 0; offset < names.length; offset += 100) {
          const page = await Native.readTablePreview!({
            id: receivedTablePreview!.id,
            kind: 'names',
            offset,
            limit: 100
          })
          check(
            page.total === names.length &&
              JSON.stringify(page.values) === JSON.stringify(names.slice(offset, offset + 100)),
            'Private table complete preview pages differ from independent input'
          )
        }
      } else {
        const candidates = text
          .slice(0, -1)
          .split('\n')
          .map((line) => {
            check(line[0] === 'T', 'Every candidate has the correct record-table purpose')
            return JSON.parse(line.slice(1))
          })
        check(candidates.length === 115, 'Each format has all 115 complete candidate rows')
        candidates.forEach((entry, index) => {
          check(
            entry.sheetOrder === 0 && entry.rowOrder === index + 1,
            'Every input row is represented once in original order'
          )
          const value = entry.value
          check(value.moduleName === '公开导入模组', 'Every candidate retains the complete module name')
          if (index < 114)
            check(
              value.sessionName === '公开导入场' + index &&
                value.link === 'https://log.weizaima.com/?key=public-io-' + index &&
                !value.manualContent,
              'Every format retains all complete names and links'
            )
          else
            check(
              value.sessionName === '公开导入完整手动正文' &&
                value.link === '' &&
                value.manualContent === 'PUBLIC_MANUAL_BEGIN\n完整😀正文\nPUBLIC_MANUAL_END',
              'Every format retains the entire final Unicode manual body'
            )
        })
        const preview = receivedTablePreview as NativeTablePreview | undefined
        const tail = await Native.readTablePreview!({
          id: preview!.id,
          kind: 'names',
          offset: 100,
          limit: 100
        })
        check(
          tail.total === 115 &&
            tail.values.length === 15 &&
            tail.values[14] === '公开导入模组 / 公开导入完整手动正文',
          'Native preview includes the last page and complete final row'
        )
      }
      if (!commit || extension !== formats[formats.length - 1] || repeat !== 2) {
        const dialog = document.querySelector('[role="dialog"][aria-label="表格导入预览"]')!
        check(button('取消', dialog), 'Table preview cancel is available')
        button('取消', dialog)!.click()
        await waitFor(
          () =>
            !document.querySelector('[role="dialog"][aria-label="表格导入预览"]') && button('导入场次表格'),
          'cancelled table lease released'
        )
        const afterCancel = await Native.getOverview()
        check(
          JSON.parse(afterCancel.json!).records.length === 78,
          'Cancelled preview must not write any record'
        )
        if (before)
          check(
            afterCancel.revision === before.revision && afterCancel.json === before.json,
            'Private cancelled preview must preserve the complete original overview'
          )
      }
    }
  }
  if (!commit) return
  await timed(
    privateMode ? 'record-table-import-commit-private' : 'record-table-import-commit-full-115',
    async () => {
      await click('确认添加表格数据')
      await waitFor(
        () => !document.querySelector('[role="dialog"][aria-label="表格导入预览"]') && button('导入场次表格'),
        'complete table commit'
      )
    }
  )
  if (privateMode) await checkPrivateImportedTable(privateRows!, before!)
  else await checkCompleteImportedTable()
}

function privateTableNames(rows: TableImportRow[]) {
  const counts = new Map<string, number>()
  return rows.map((row) => {
    const count = (counts.get(row.moduleName) ?? 0) + 1
    counts.set(row.moduleName, count)
    return row.moduleName + ' / ' + (row.sessionName || '第' + count + '场')
  })
}

/** Complete runtime-only values are compared in memory; assertions never print them. */
async function checkPrivateImportedTable(
  rows: TableImportRow[],
  before: Awaited<ReturnType<typeof Native.getOverview>>
) {
  const state = await Native.getOverview(),
    original = JSON.parse(before.json!),
    metadata = JSON.parse(state.json!)
  check(state.revision === before.revision + 1, 'Private table must commit exactly one CAS revision')
  const oldIDs = new Set(original.records.map((row: SessionRecord) => row.id))
  const added = (metadata.records as SessionRecord[]).filter((row) => !oldIDs.has(row.id))
  check(
    metadata.records.length === original.records.length + rows.length && added.length === rows.length,
    'Private table must retain all original and imported records'
  )
  const complete = JSON.parse(
    (await Native.getRecordContent({ ids: added.map((row) => row.id), expectedRevision: state.revision }))
      .json
  )
  check(complete.records.length === rows.length, 'Every private imported record must be independently reread')
  const records = new Map<string, SessionRecord>(
    (complete.records as SessionRecord[]).map((row) => [row.id, row])
  )
  check(records.size === rows.length, 'Private imported IDs must be unique')
  const groups = new Map<string, TableImportRow[]>()
  for (const row of rows) groups.set(row.moduleName, [...(groups.get(row.moduleName) ?? []), row])
  check(groups.size === expectedPrivateTable!.moduleRows.length, 'All private input modules must be retained')
  for (const [name, input] of groups) {
    check(
      !original.modules.some((module: ModuleRecord) => module.name === name),
      'Private fixture must use independent modules'
    )
    const modules = (metadata.modules as ModuleRecord[]).filter((module) => module.name === name)
    check(modules.length === 1, 'Each private module must be committed exactly once')
    const module = modules[0]!,
      saved = added.filter((row) => row.moduleId === module.id).sort((a, b) => a.order - b.order)
    check(saved.length === input.length, 'Private module record counts must match all sheets')
    let participants = { kps: [] as string[], pairs: [] as { pc: string; pl: string }[] }
    input.forEach((expected, index) => {
      participants = mergeImportedParticipants(participants, expected)
      const record = records.get(saved[index]!.id)!
      check(
        record && record.moduleId === module.id && record.order === index && record.sequenceNo === index + 1,
        'Private record module, order and sequence must match'
      )
      check(
        record.name === (expected.sessionName || '第' + (index + 1) + '场') &&
          (record.link ?? '') === expected.link,
        'Every private name and complete link must match'
      )
      const manual = expected.manualContent?.trim() ? expected.manualContent : expected.link ? undefined : ''
      check(
        record.manualContent === manual && record.rawContent === undefined,
        'Every private manual body must match completely without raw-body substitution'
      )
      check(
        record.sourceType === (expected.link && !manual ? 'online' : 'manual') &&
          record.status === (expected.link && !manual ? 'pending' : 'manual'),
        'Private record source and status must match import semantics'
      )
      check((record.playDate ?? '') === (expected.playDate ?? ''), 'Private play dates must be preserved')
    })
    check(
      JSON.stringify(module.kps) === JSON.stringify(participants.kps) &&
        JSON.stringify(module.pairs) === JSON.stringify(participants.pairs),
      'All private module participants must be retained'
    )
  }
}

async function checkCompleteImportedTable() {
  const state = await Native.getOverview(),
    metadata = JSON.parse(state.json!)
  check(metadata.records.length === 193, 'All original and 115 imported records survive')
  const module = metadata.modules.find((row: { name: string }) => row.name === '公开导入模组')
  check(module, 'Complete imported module exists')
  const rows = metadata.records.filter((row: { moduleId: string }) => row.moduleId === module.id)
  check(rows.length === 115, 'Imported module contains every row exactly once')
  for (let i = 0; i < 114; i++) {
    const matching = rows.filter((row: { name: string }) => row.name === '公开导入场' + i)
    check(
      matching.length === 1 && matching[0].link === 'https://log.weizaima.com/?key=public-io-' + i,
      'Every complete link and name matches the independent public input'
    )
  }
  const manual = rows.find((row: { name: string }) => row.name === '公开导入完整手动正文')
  check(manual, 'Last manual row is present')
  const content = JSON.parse(
    (await Native.getRecordContent({ ids: [manual.id], expectedRevision: state.revision })).json
  )
  check(
    content.records[0].manualContent === 'PUBLIC_MANUAL_BEGIN\n完整😀正文\nPUBLIC_MANUAL_END',
    'Last manual Unicode body is complete'
  )
}

/** @returns Completes all supported table, backup and six-format single/batch/combined exports through the packaged UI. */
async function completeMatrix() {
  confirmations = setInterval(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="确认操作"]')
    if (dialog) button('确认', dialog)?.click()
  }, 20)
  await click('数据与设置')
  for (const extension of ['csv', 'xlsx', 'xls']) {
    window.__publicIoSource = 'public-io-table.' + extension
    await timed('record-table-import-preview-' + extension, async () => {
      await click('导入场次表格')
      await waitFor(
        () => document.querySelector('[role="dialog"][aria-label="表格导入预览"]'),
        'table preview ' + extension
      )
    })
    await timed('record-table-import-commit-' + extension, async () => {
      await click(button('确认添加或更新表格数据') ? '确认添加或更新表格数据' : '确认添加表格数据')
      await waitFor(
        () => !document.querySelector('[role="dialog"][aria-label="表格导入预览"]'),
        'table commit ' + extension
      )
      await waitFor(() => button('导入场次表格'), 'table commit unlocked')
    })
    const state = await Native.getOverview(),
      metadata = JSON.parse(state.json!)
    check(metadata.records.length === 193, 'All 114 links and complete manual record must survive')
    const manual = metadata.records.find((row: { name: string }) => row.name === '公开导入完整手动正文')
    const content = JSON.parse(
      (await Native.getRecordContent({ ids: [manual.id], expectedRevision: state.revision })).json
    )
    check(
      content.records[0].manualContent === 'PUBLIC_MANUAL_BEGIN\n完整😀正文\nPUBLIC_MANUAL_END',
      'Manual Unicode/newlines must be complete'
    )
    await checkCompleteImportedTable()
    if (extension === 'csv')
      results.push({ ...results[results.length - 1]!, operation: 'record-table-import-commit-full-115' })
  }
  for (const [label, operation] of [
    ['导出记录 CSV', 'record-table-export-csv'],
    ['导出记录 Excel', 'record-table-export-xlsx'],
    ['保存空白模板 CSV', 'blank-template-csv'],
    ['保存空白模板 Excel', 'blank-template-xlsx']
  ])
    await saved(operation!, () => click(label!))
  const backups: SavedDocument[] = []
  backups.push(
    ...(await saved('backup-export-json', () =>
      click(Capacitor.getPlatform() === 'ios' ? '保存手机备份' : '保存安卓备份')
    ))
  )
  backups.push(...(await saved('backup-export-zip-with-attachments', () => click('保存含归档 ZIP 备份'))))
  check(
    /^[0-9]{8}COC跑团记录簿\.json$/.test(backups[0]!.name),
    'First backup uses date and app name without sequence'
  )
  check(
    backups[1]!.name === backups[0]!.name.replace(/\.json$/, '1.zip'),
    'JSON and ZIP share daily sequence from one'
  )
  for (const backup of backups) {
    window.__publicIoSource = backup.name
    const extension = backup.name.endsWith('.zip') ? 'zip' : 'json'
    await timed('backup-import-preview-' + extension, async () => {
      await click('选择备份并预览')
      await waitFor(
        () => document.querySelector('[role="dialog"][aria-labelledby="restore-title"]'),
        'backup preview'
      )
    })
    await timed('backup-import-commit-' + extension, async () => {
      await click('确认覆盖并导入')
      await waitFor(() => button('批量检测'), 'backup restore completed')
    })
    const state = await Native.getOverview()
    check(JSON.parse(state.json!).records.length === 193, 'Restored complete metadata')
    const rows = JSON.parse(
      (
        await Native.getRecordContent({
          ids: ['public-io-0', 'public-io-77'],
          expectedRevision: state.revision
        })
      ).json
    ).records
    check(
      rows.every(
        (row: { rawContent: { messages: Array<{ text: string }> } }) =>
          row.rawContent.messages.length === 650 && row.rawContent.messages[649]!.text.includes('PUBLIC_END_')
      ),
      'Restored complete first and last raw bodies'
    )
    await click('数据与设置')
  }
  const automatic = await saved('automatic-backup-json', () => click('立即生成自动备份'))
  check(
    automatic[0]!.name === backups[0]!.name.replace(/\.json$/, '2.json'),
    'Automatic backup continues the daily sequence'
  )
  await click('跑团记录')
  const moduleToggle = await waitFor(
    () => document.querySelector<HTMLButtonElement>('[data-module-toggle][aria-label="模组 公开计时模组"]'),
    'original public module'
  )
  if (moduleToggle.getAttribute('aria-expanded') !== 'true') {
    moduleToggle.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const first = await waitFor(
    () => document.querySelector<HTMLButtonElement>('[data-record-id="public-io-0"]'),
    'public record'
  )
  first.click()
  await waitFor(() => button('更多导出格式'), 'reader ready')
  await timed('reader-submitted-search', async () => {
    const field = document.querySelector<HTMLInputElement>('input[aria-label="搜索整场正文"]')!
    input(field, 'PUBLIC_IO_NEEDLE')
    await new Promise((resolve) => setTimeout(resolve, 0))
    check(!document.querySelector('.search-results'), 'Typing must not search the saved reader body')
    document.querySelector<HTMLButtonElement>('button[aria-label="搜索整场正文"]')!.click()
    await waitFor(
      () => document.querySelector('.search-results')?.textContent?.includes('匹配 650 条'),
      'complete submitted reader search'
    )
    document.querySelector<HTMLButtonElement>('button[aria-label="清空正文搜索"]')!.click()
    await waitFor(() => !document.querySelector('.search-results'), 'clear cancels reader results')
  })
  for (const label of ['原始 JSON', 'TXT', '带图 DOC', '纯对话 DOC', 'DOCX', 'PDF']) {
    await saved('single-export-' + label, async () => {
      await click('更多导出格式')
      await chooseExport(label)
    })
  }
  await click('返回场次')
  await click('全选此模组')
  const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('.selection-check input'))
  check(boxes.length === 78, 'Select only the public raw module')
  for (const box of boxes.slice(2)) {
    box.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  for (const combined of [false, true])
    for (const label of ['原始 JSON', 'TXT', '带图 DOC', '纯对话 DOC', 'DOCX', 'PDF']) {
      await saved(
        (combined ? 'combined' : 'batch') + '-export-' + label,
        async () => {
          await click(combined ? '合成导出' : '批量导出')
          check(
            document
              .querySelector('[role="dialog"][aria-label="导出日志"]')
              ?.textContent?.includes('已选择 2 个场次'),
            'Exactly two complete records'
          )
          await chooseExport(label)
        },
        combined ? 1 : 2
      )
    }
}

void (async () => {
  try {
    check(
      (window.__publicIoConfig.mode === 'private-table') === !!window.__publicIoConfig.localPrivateTable,
      'Private table mode and runtime input configuration must agree'
    )
    if (window.__publicIoConfig.localPrivateTable)
      expectedPrivateTable = requirePrivateTableExpectation(window.__publicIoConfig.expectedTableProof)
    const overview = await Native.getOverview(),
      library = JSON.parse(overview.json!)
    check(
      library.records.length === 78 &&
        library.records.every((r: { id: string }) => /^public-io-\d+$/.test(r.id)),
      'Refuse non-public library'
    )
    await waitFor(() => document.querySelector<HTMLInputElement>('.module-body-search input'), 'module input')
    const queries = ['PUBLIC_IO_NEEDLE', 'PUBLIC_END_', '公开完整正文']
    for (
      let repeat = 0;
      ['baseline', 'complete'].includes(window.__publicIoConfig.mode) && repeat < 3;
      repeat++
    ) {
      // Prepare the visible controls before the timed click; no source is read
      // until submission, and complete result publication stays inside timing.
      const beforePreparation = calls.filter(call => call.method === 'createSearchSource').length
      const field = document.querySelector<HTMLInputElement>('.module-body-search input')!
      input(field, queries[repeat]!)
      await new Promise((resolve) => setTimeout(resolve, 0))
      const submit = await waitFor(
          () => document.querySelector<HTMLButtonElement>('button[aria-label="搜索模组正文"]'),
          'search submit'
        )
      submit.scrollIntoView({ block: 'center' })
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const bounds = submit.getBoundingClientRect()
      const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      check(document.visibilityState === 'visible' && !submit.disabled && !!target && submit.contains(target), 'Search control must be visible and actionable')
      check(calls.filter(call => call.method === 'createSearchSource').length === beforePreparation, 'Search preparation must not read a source')
      await timed('module-search-' + repeat, async () => {
        submit.click()
        await waitFor(
          () =>
            document
              .querySelector('.module-body-search [role="status"]')
              ?.textContent?.includes('匹配 78 个场次'),
          'complete 78-record search'
        )
        check(
          document
            .querySelector('.search-result')
            ?.textContent?.includes((repeat === 2 ? 7800 : 650) + ' 处'),
          'Search count must preserve complete messages'
        )
      })
      if (Capacitor.getPlatform() === 'ios') {
        const sample = results[results.length - 1]!
        check(sample.totalMs <= 600 && Number.isFinite(sample.responseMs) && sample.responseMs! <= 100,
          'Every complete iOS search requires 600ms total and 100ms visible response: ' + JSON.stringify(sample))
      }
      document.querySelector<HTMLButtonElement>('button[aria-label="清空模组正文搜索"]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (!['tables', 'private-table'].includes(window.__publicIoConfig.mode)) {
      await click('角色卡')
      if (['complete', 'cards'].includes(window.__publicIoConfig.mode)) {
        window.__publicIoSource = 'public-io-card-spill.xlsx'
        delayNextStageForCancellation = true
        await timed('character-import-back-cancel-with-delayed-stage', async () => {
          await click('导入七版角色卡')
          await waitFor(
            () =>
              !delayNextStageForCancellation &&
              document.querySelector('[role="progressbar"][aria-label="导入处理进度"]'),
            'real card progress before back'
          )
          cancelImportFromBack(Capacitor.getPlatform(), document, window)
          await waitFor(
            () => button('导入七版角色卡') && !document.querySelector('.editor'),
            'back cancellation finished'
          )
          check(
            (await Native.getOverview()).revision === overview.revision,
            'Back-cancelled card must not write'
          )
        })
        await delayedCancellationStage
        delayNextStageForCancellation = false
      }
      for (const extension of window.__publicIoConfig.mode === 'matrix' ? [] : ['xlsx', 'xls'])
        for (let repeat = 0; repeat < 3; repeat++) {
          window.__publicIoSource = 'public-io-card.' + extension
          if (extension === 'xls') {
            await timed('character-import-xls-explicit-rejection-' + repeat, async () => {
              await click('导入七版角色卡')
              await waitFor(
                () =>
                  document
                    .querySelector('[role="alert"]')
                    ?.textContent?.includes('请选择七版角色卡的 XLSX 文件'),
                'unsupported card explicitly rejected'
              )
            })
            check(
              (await Native.getOverview()).revision === overview.revision,
              'Unsupported card must not write'
            )
            continue
          }
          await timed('character-import-' + extension + '-' + repeat, async () => {
            await click('导入七版角色卡')
            await waitFor(
              () =>
                document.querySelector<HTMLInputElement>('.editor input[role="combobox"]')?.value ===
                (window.__publicIoConfig.expectedCardName ?? '公开七版调查员'),
              'complete character draft'
            )
            if (window.__publicIoConfig.localPrivateCard)
              await waitFor(
                () => privateDraftProof === window.__publicIoConfig.expectedCardProof,
                'complete character fields equal independent original importer'
              )
          })
          await click('取消编辑')
          if (button('确认')) await click('确认')
          await waitFor(() => button('导入七版角色卡'), 'character cancellation')
          check((await Native.getOverview()).revision === overview.revision, 'Cancelled card must not write')
        }
    }
    if (['tables', 'private-table'].includes(window.__publicIoConfig.mode)) await measureRecordTables()
    if (window.__publicIoConfig.mode === 'complete') await measureRecordTables(false)
    if (['complete', 'matrix'].includes(window.__publicIoConfig.mode)) await completeMatrix()
    window.__publicIoResult = {
      passed: true,
      results,
      documents: window.__publicIoConfig.localPrivateTable ? [] : published,
      source: window.__publicIoConfig.localPrivateTable
        ? 'user-selected private table supplied locally at runtime; complete candidate and committed values checked; no private data packaged or uploaded'
        : window.__publicIoConfig.localPrivateCard
          ? 'user-selected private card supplied locally at runtime; no private data packaged or uploaded; actual WebView, Worker, SQLite and native copy'
          : 'fictional public fixtures; actual WebView, Worker, SQLite and bounded native file copy; OS picker response is deterministic',
      physicalPhone: undefined
    }
  } catch (error) {
    window.__publicIoResult = {
      passed: false,
      stage: window.__publicIoStage,
      error: window.__publicIoConfig.localPrivateTable
        ? 'Private table validation failed; private details withheld'
        : String(error),
      results
    }
  } finally {
    delete window.__publicIoObserveDraft
    delete window.__publicIoObserveEditor
    cap.nativePromise = nativePromise
    clearInterval(confirmations)
  }
})()
