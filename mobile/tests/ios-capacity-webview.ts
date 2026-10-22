// Bundled only into CI's temporary directory and injected into DEBUG simulator.
import { Native } from '../src/data/native'
import { exportNativeBackup, previewNativeBackup } from '../src/data/backup-stream-client'
import type { NativeRestoreSource } from '../src/data/backup-stream-native'
import { readLocalSourceStream } from '../src/data/local-source-stream'
import { Capacitor } from '@capacitor/core'

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
    check(rangedRequests > 300 && largestRange <= 262144, 'WK native range path not exercised')
    return {
      passed: true,
      stage: 'complete',
      records: 96,
      logicalBytes: initial.storageUsage!.logicalBytes,
      jsonBytes: json.bytes,
      zipBytes: zip.bytes,
      automaticBytes: automatic.document.bytes,
      rangeProbeBytes,
      rangedRequests,
      largestRange,
      revision: restored.revision,
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
