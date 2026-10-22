// Instrumentation assets only; never included in the release web bundle.
import { Native } from '../src/data/native'
import { searchNativeBodies } from '../src/data/backup-stream-client'
declare global {
  interface Window {
    __publicCapacityTask: Promise<unknown>
    __publicCapacityResult: unknown
  }
}
window.__publicCapacityTask = (async () => {
  try {
    const initial = await Native.getOverview!(),
      data = JSON.parse(initial.json!)
    if (
      data.records.length !== 96 ||
      !data.records.every((row: { id: string }) => /^public-native-read-\d+$/.test(row.id))
    )
      throw Error('Refuse non-public data')
    const result = await searchNativeBodies(
      Native,
      data.records.map((row: { id: string }) => row.id),
      initial.revision,
      'PUBLIC_CAPACITY_END',
      data.settings.filterPreset,
      new AbortController().signal
    )
    const after = await Native.getOverview!()
    if (
      result.hits.length !== 96 ||
      result.hits.some((row) => row.matches !== 1) ||
      after.revision !== initial.revision
    )
      throw Error('Incomplete or mutating read-only search')
    return {
      passed: true,
      records: 96,
      hits: result.hits.length,
      logicalBytes: initial.storageUsage!.logicalBytes,
      revision: after.revision,
      worker: true,
      nativeWebView: true,
      physicalPhone: false
    }
  } catch (error) {
    return { passed: false, error: String(error) }
  }
})()
window.__publicCapacityTask.then((result) => {
  window.__publicCapacityResult = result
})
