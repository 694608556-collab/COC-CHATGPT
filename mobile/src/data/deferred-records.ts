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

/**
 * 完整核对所选正文批次，不为每个场次重复扫描列表；失败时不修改当前快照。
 * @param current - 已校验的当前概览，可包含尚未读取的正文。
 * @param content - 经正文读取边界校验的完整返回批次。
 * @param ids - 本次请求的唯一场次 ID；必须全部返回且归属、来源不变。
 * @returns 合并全部已核对正文的新快照；设置和未选实体保留原对象。
 */
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
  const existing = new Map(current.records.map((record) => [record.id, record]))
  for (const id of wanted) {
    const before = existing.get(id),
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
