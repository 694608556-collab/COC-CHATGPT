// Instrumentation-only asset. The release bundle never imports this module.
import { Native } from '../src/data/native'
import { previewNativeTable } from '../src/data/table-stream-client'
import { encodeBase64, decodeBase64 } from '../src/data/bytes'
import type { NativeTableSource } from '../src/data/table-stream-native'

declare global {
  interface Window {
    __publicNativeTableSource: NativeTableSource
    __publicNativeTableResult: unknown
  }
}
void (async () => {
  const source = window.__publicNativeTableSource
  try {
    const before = await Native.getOverview()
    if (before.json !== null || before.revision !== 0 || source.name !== 'public-bridge.csv')
      throw Error('Refuse non-public table test state')
    const shared = '公开共享字符串😀'
    await Native.appendTableStage!({
      id: source.id,
      key: 'strings',
      index: 0,
      base64: encodeBase64(new TextEncoder().encode(JSON.stringify([0, shared]) + '\n'))
    })
    const string = await Native.readTableString!({ id: source.id, stringIndex: 0, offset: 0 })
    if (!string.done || new TextDecoder().decode(decodeBase64(string.base64)) !== shared)
      throw Error('Native UTF8 string bridge incomplete')
    const preview = await previewNativeTable(Native, source, 'records')
    if (preview.added !== 2 || preview.updated !== 1 || preview.skipped !== 1)
      throw Error('Native preview semantics changed: ' + JSON.stringify(preview))
    const page = await Native.readTablePreview!({ id: source.id, kind: 'names', offset: 0, limit: 100 })
    if (page.total !== 3 || page.values.length !== 3) throw Error('Native preview page incomplete')
    const saved = await Native.commitTableStream!({ id: source.id, confirmed: true })
    const after = await Native.getOverview(), metadata = JSON.parse(after.json!)
    const bodies = JSON.parse((await Native.getRecordContent({
      ids: metadata.records.map((record: { id: string }) => record.id),
      expectedRevision: after.revision
    })).json)
    if (saved.revision !== 1 || after.revision !== 1 || metadata.records.length !== 2 ||
        bodies.records[0].manualContent !== '公开更新😀\n完整正文' || metadata.records[1].sourceType !== 'online')
      throw Error('Native table commit/body reread incomplete')
    window.__publicNativeTableResult = { passed: true, revision: after.revision, records: 2, added: preview.added,
      updated: preview.updated, skipped: preview.skipped, worker: true, nativeBridge: true, persistedTestGrant: true, physicalPhone: false }
  } catch (error) {
    await Native.cancelTableStage!({ id: source.id }).catch(() => {})
    window.__publicNativeTableResult = { passed: false, error: String(error) }
  }
})()
