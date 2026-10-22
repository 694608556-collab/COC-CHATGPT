// Bundled only into CI's temporary directory and injected into DEBUG simulator.
import { Native } from '../src/data/native'
import { exportNativeBackup, previewNativeBackup, searchNativeBodies } from '../src/data/backup-stream-client'
import type { NativeRestoreSource } from '../src/data/backup-stream-native'
import { readLocalSourceStream } from '../src/data/local-source-stream'
import { Capacitor } from '@capacitor/core'
import { previewNativeTable, confirmNativeTable } from '../src/data/table-stream-client'
import type { NativeTableSource } from '../src/data/table-stream-native'
import { encodeBase64 } from '../src/data/bytes'

declare global {
  interface Window {
    __cocSmokeTask: Promise<unknown>
    __cocSmokeResult: unknown
    __cocSmokeStage: string
  }
}
window.__cocSmokeTask = (async () => {
  let stage = 'public-library',
    rangedRequests = 0,
    largestRange = 0
  const check = (ok: unknown, message: string) => {
    if (!ok) throw Error(message)
  }
  const setStage = (value: string) => {
    stage = value
    window.__cocSmokeStage = value
  }
  const fetch = window.fetch.bind(window)
  window.fetch = ((input, init) => {
    const headers = new Headers(init?.headers),
      value = headers.get('Range')
    if (String(input).includes('/_capacitor_file_/')) {
      check(value && /^bytes=\d+-\d+$/.test(value), 'Native file request must be ranged')
      const [start, end] = value!.slice(6).split('-').map(Number)
      const length = end! - start! + 1
      check(length <= 262144, 'Native file range is unbounded')
      rangedRequests++
      largestRange = Math.max(largestRange, length)
    }
    return fetch(input, init)
  }) as typeof window.fetch
  try {
    const initial = await Native.getOverview!(),
      data = JSON.parse(initial.json!)
    check(
      initial.backupStreamVersion === 1 &&
        data.records.length === 96 &&
        data.records.every((r: { id: string }) => /^public-capacity-\d+$/.test(r.id)),
      'Refuse any non-public library'
    )
    check(initial.storageUsage!.logicalBytes > 96 * 1024 * 1024, 'Library must exceed old cap')
    setStage('native-read-only-stream-search')
    const searched = await searchNativeBodies(
      Native,
      data.records.map((row: { id: string }) => row.id),
      initial.revision,
      'PUBLIC_CAPACITY_END',
      data.settings.filterPreset,
      new AbortController().signal
    )
    check(
      searched.hits.length === 96 && searched.hits.every((hit) => hit.matches === 1),
      'Large module search incomplete'
    )
    check(
      (await Native.getOverview!()).revision === initial.revision,
      'Read-only search must not change SQLite'
    )
    await Native.selectArchive({ localFolder: true })
    setStage('native-complete-json')
    const json = await exportNativeBackup(Native, initial.revision, false, 'public-capacity-complete.json')
    check(json.bytes > 96 * 1024 * 1024, 'Complete JSON too short')
    setStage('packaged-worker-complete-zip')
    const zip = await exportNativeBackup(Native, initial.revision, true, 'public-capacity-complete.zip')
    check(zip.bytes > 96 * 1024 * 1024, 'Complete ZIP too short')
    async function open(uri: string): Promise<NativeRestoreSource> {
      // This option is compiled out of Release and accepted only by the existing
      // DEBUG simulator public scale launch hook, for a registered backup.
      const result = await (Native.openBackup as (o: unknown) => Promise<{ source: NativeRestoreSource }>)({
        kind: 'backup',
        stream: true,
        expectedRevision: initial.revision,
        publicRestoreDocument: uri
      })
      return result.source
    }
    setStage('ranged-json-preview-cancel')
    const source = await open(json.uri)
    let rangeProbeBytes = 0
    for await (const chunk of readLocalSourceStream(
      { ...source, url: Capacitor.convertFileSrc(source.fileUri), ranged: true },
      { maximumBytes: source.bytes }
    ))
      rangeProbeBytes += chunk.length
    check(rangeProbeBytes === source.bytes, 'Actual WK ranged source proof incomplete')
    const preview = await previewNativeBackup(Native, source)
    check(preview.snapshot.records.length === 96 && preview.offlineRecords === 96, 'JSON preview incomplete')
    check((await Native.getOverview!()).revision === initial.revision, 'Preview must not auto-confirm')
    await Native.cancelBackupStage!({ id: preview.lease })
    setStage('ranged-zip-preview-restore')
    const zipped = await previewNativeBackup(Native, await open(zip.uri))
    const restored = await Native.commitBackupRestore!({
      id: zipped.lease,
      confirmed: true,
      restoreSettings: true
    })
    check(restored.revision === initial.revision + 1, 'Restore must commit exactly once')
    const last = await Native.getRecordContent({
      ids: ['public-capacity-0', 'public-capacity-95'],
      expectedRevision: restored.revision
    })
    for (const row of JSON.parse(last.json).records) {
      check(
        row.manualContent.startsWith('PUBLIC_CAPACITY_BEGIN😀\0') &&
          row.manualContent.endsWith('PUBLIC_CAPACITY_END') &&
          row.manualContent.length > 1024 * 1024,
        'Complete first/last body mismatch'
      )
    }
    setStage('native-complete-auto-backup')
    const automatic = await Native.automaticBackup({ expectedRevision: restored.revision })
    check(
      automatic.document.bytes > 96 * 1024 * 1024 && automatic.revision === restored.revision,
      'Automatic backup incomplete'
    )
    setStage('native-table-stream-source')
    check(initial.tableStreamVersion === 1, 'Native table stream capability missing')
    const manual = (index: number) =>
      `PUBLIC_TABLE_BEGIN_${index}\n${'完整正文😀,'.repeat(300)}\nPUBLIC_TABLE_END_${index}`
    const cell = (value: string) => '"' + value.replace(/"/g, '""') + '"'
    const csv = new TextEncoder().encode(
      [
        '模组名,场次名,海豹链接,手动保存内容',
        ...Array.from({ length: 205 }, (_, index) =>
          ['公开原生表格团', `PUBLIC_TABLE_SESSION_${index}`, '', manual(index)].map(cell).join(',')
        )
      ].join('\r\n')
    )
    check(csv.length > 262144, 'Public table source must exercise multiple WK ranges')
    const tableDocument = await Native.writeArchive({
      name: 'public-table-stream.csv',
      mime: 'text/csv',
      base64: encodeBase64(csv),
      purpose: 'export'
    })
    async function openTable(): Promise<NativeTableSource> {
      const result = await (Native.openBackup as (o: unknown) => Promise<{ tableSource: NativeTableSource }>)(
        {
          kind: 'record-table',
          stream: true,
          expectedRevision: restored.revision,
          publicRestoreDocument: tableDocument.uri
        }
      )
      return result.tableSource
    }
    const sourceTable = await openTable()
    let tableRangeBytes = 0
    for await (const chunk of readLocalSourceStream(
      { ...sourceTable, url: Capacitor.convertFileSrc(sourceTable.fileUri), ranged: true },
      { maximumBytes: sourceTable.bytes }
    ))
      tableRangeBytes += chunk.length
    check(tableRangeBytes === csv.length, 'Public table WK ranges did not cover complete source')
    setStage('packaged-table-worker-native-preview')
    const tablePreview = await previewNativeTable(Native, sourceTable, 'records')
    check(
      tablePreview.added === 205 &&
        tablePreview.updated === 0 &&
        tablePreview.names.length === 100 &&
        tablePreview.namesCount === 205,
      'Native table initial preview incomplete'
    )
    const page = await Native.readTablePreview!({
      id: tablePreview.id,
      kind: 'names',
      offset: 200,
      limit: 100
    })
    check(
      page.total === 205 && page.values.length === 5 && page.values[4]!.endsWith('PUBLIC_TABLE_SESSION_204'),
      'Native table SQLite preview pagination failed'
    )
    check(
      (await Native.getOverview()).revision === restored.revision,
      'Native table preview wrote production state'
    )
    await Native.cancelTableStage!({ id: tablePreview.id })
    let cancelled = false
    try {
      await Native.readTablePreview!({ id: tablePreview.id, kind: 'names', offset: 0, limit: 100 })
    } catch {
      cancelled = true
    }
    check(
      cancelled && (await Native.getOverview()).revision === restored.revision,
      'Native table cancellation did not release owner'
    )
    setStage('native-table-stream-commit')
    const tableAgain = await previewNativeTable(Native, await openTable(), 'records')
    const tableSaved = await confirmNativeTable(Native, tableAgain.id)
    check(tableSaved.revision === restored.revision + 1, 'Native table must commit once')
    const tableOverview = await Native.getOverview(),
      tableData = JSON.parse(tableOverview.json!)
    const finalTableRow = tableData.records.find(
      (record: { name: string }) => record.name === 'PUBLIC_TABLE_SESSION_204'
    )
    check(tableData.records.length === 301 && finalTableRow, 'Native table lost prior or new records')
    const tableBodies = await Native.getRecordContent({
      ids: ['public-capacity-0', 'public-capacity-95', finalTableRow.id],
      expectedRevision: tableSaved.revision
    })
    const tableRows = JSON.parse(tableBodies.json).records
    check(
      tableRows.find((record: { id: string }) => record.id === finalTableRow.id).manualContent ===
        manual(204),
      'Native table full multiline final body changed'
    )
    for (const old of JSON.parse(last.json).records) {
      check(
        JSON.stringify(tableRows.find((record: { id: string }) => record.id === old.id)) ===
          JSON.stringify(old),
        'Native table rewrote a previous complete record'
      )
    }
    check(rangedRequests > 300 && largestRange <= 262144, 'WK native range path not exercised')
    setStage('native-large-module-bridge')
    const originalModule = tableData.modules[0]
    const largeModuleName = 'PUBLIC_MODULE_' + 'M'.repeat(2 * 1024 * 1024) + '_END'
    const largeModule = await Native.commitModule({
      value: { ...originalModule, name: largeModuleName },
      expectedRevision: tableSaved.revision
    })
    const moduleOverview = await Native.getOverview!()
    check(
      moduleOverview.revision === largeModule.revision &&
        JSON.parse(moduleOverview.json!).modules.find((item: { id: string }) => item.id === originalModule.id)
          .name === largeModuleName,
      'Native module bridge truncated or rejected a valid module above1MiB'
    )
    await Native.commitModule({ value: originalModule, expectedRevision: largeModule.revision })
    return {
      passed: true,
      stage: 'complete',
      records: 96,
      searchHits: searched.hits.length,
      logicalBytes: initial.storageUsage!.logicalBytes,
      jsonBytes: json.bytes,
      zipBytes: zip.bytes,
      automaticBytes: automatic.document.bytes,
      rangeProbeBytes,
      rangedRequests,
      largestRange,
      revision: restored.revision,
      tableAdded: tablePreview.added,
      tableSourceBytes: csv.length,
      tableRangeBytes,
      tableRevision: tableSaved.revision,
      recordsAfterTable: tableData.records.length,
      moduleBridgeBytes: largeModuleName.length,
      nativeSQLite: true,
      packagedWorker: true,
      physicalPhone: false
    }
  } catch (error) {
    return { passed: false, stage, error: String(error), rangedRequests, largestRange }
  }
})()
window.__cocSmokeTask.then((result) => {
  window.__cocSmokeResult = result
})
