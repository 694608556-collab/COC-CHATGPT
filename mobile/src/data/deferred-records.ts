import type { MobileSnapshot } from './types'

/** Keep missing bodies explicit; an overview must never be serialized as a full backup or edit. */
export function deferredIds(snapshot: MobileSnapshot, ids: unknown): Set<string> {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error('正文索引无效。')
  const result = new Set<string>(ids)
  const records = new Set(snapshot.records.map((record) => record.id))
  if (result.size !== ids.length || [...result].some((id) => !records.has(id)))
    throw new Error('正文索引与列表不一致，请重新读取。')
  return result
}

/** Only accept the entire requested batch, with unchanged ownership and no unrelated records. */
export function mergeRecordContent(
  current: MobileSnapshot,
  content: MobileSnapshot,
  ids: string[]
): MobileSnapshot {
  const wanted = new Set(ids)
  const rows = new Map(content.records.map((record) => [record.id, record]))
  if (
    wanted.size !== ids.length ||
    rows.size !== wanted.size ||
    [...rows.keys()].some((id) => !wanted.has(id))
  )
    throw new Error('正文读取不完整，请重试。')
  for (const id of wanted) {
    const before = current.records.find((record) => record.id === id),
      after = rows.get(id)
    if (
      !before ||
      !after ||
      before.moduleId !== after.moduleId ||
      before.sourceType !== after.sourceType ||
      before.link !== after.link ||
      (!after.rawContent && after.manualContent === undefined)
    )
      throw new Error('正文与当前场次不一致，请重新读取。')
  }
  return { ...current, records: current.records.map((record) => rows.get(record.id) ?? record) }
}
