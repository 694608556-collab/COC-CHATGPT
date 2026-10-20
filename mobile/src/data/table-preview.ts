import type { MobileSnapshot } from './types'

/** 生成只含元数据的表格预览基线，正文仍由原快照/原生库持有。
 * @param current 当前列表快照，可以含已读取或延迟读取的正文。
 * @returns 独立记录外壳，不包含旧rawContent/manualContent，也不修改输入。
 */
export function tablePreviewBaseline(current: MobileSnapshot): MobileSnapshot {
  return {
    ...current,
    records: current.records.map((record) => ({ ...record, rawContent: undefined, manualContent: undefined }))
  }
}

/** 用户合并传入快照已持有的正文，仅表格明确提供的正文覆盖原值。
 * @param preview 已校验的完整预览候选，不含原有大正文。
 * @param complete 同一revision的原快照，可仅持有已缓存正文；未读正文仍由原生库保留。
 * @returns 保留预览元数据/新记录/手动更新与传入旧正文的候选；不主动读取缺失正文。
 */
export function restoreTableBodies(preview: MobileSnapshot, complete: MobileSnapshot): MobileSnapshot {
  const originals = new Map(complete.records.map((record) => [record.id, record]))
  return {
    ...preview,
    records: preview.records.map((record) => {
      const original = originals.get(record.id)
      return original
        ? {
            ...record,
            rawContent: record.rawContent ?? original.rawContent,
            manualContent: record.manualContent ?? original.manualContent
          }
        : record
    })
  }
}

/** 开发存储与原生事务采用同一追加约束；只允许明确手动更新改变旧场次。
 * @param proposed 不带旧正文的已校验表格候选。
 * @param current 完整的当前版本（仅浏览器开发存储在此合并正文）。
 * @returns 保留全部旧正文的完整候选；非法删改在写入前拒绝。
 */
export function mergeTableImport(proposed: MobileSnapshot, current?: MobileSnapshot): MobileSnapshot {
  /** 比较已通过快照校验的JSON字段，忽略可选字段的undefined外壳。
   * @param a 旧字段值。
   * @param b 候选字段值。
   * @returns 字段及子项是否等价，不编码或修改正文。
   */
  const equal = (a: unknown, b: unknown): boolean => {
    if (a === b) return true
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
    const keys = Object.keys(a).filter((key) => (a as Record<string, unknown>)[key] !== undefined)
    const other = Object.keys(b).filter((key) => (b as Record<string, unknown>)[key] !== undefined)
    return (
      keys.length === other.length &&
      keys.every((key) => equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
    )
  }
  /** @returns 始终抛出候选非法错误，由调用方保持原存储不变。 */
  const fail = (): never => {
    throw new Error('表格候选包含旧数据删除、来源变更或非手动覆盖；未保存。')
  }
  if (proposed.records.some((r) => r.rawContent !== undefined)) fail()
  if (!current) return proposed
  if (!equal(proposed.settings, current.settings)) fail()
  for (const [before, after, allowed] of [
    [current.modules, proposed.modules, ['kps', 'pairs']],
    [current.characters, proposed.characters, []],
    [
      current.records,
      proposed.records,
      ['rawContent', 'manualContent', 'updatedAt', 'playDate', 'dateSource']
    ]
  ] as const) {
    const rows = new Map(after.map((row) => [row.id, row]))
    for (const [index, old] of before.entries()) {
      if (after[index]?.id !== old.id) fail()
      const next = rows.get(old.id)
      if (!next) fail()
      /** @param row 待比较的元数据。 @returns 去除该导入类型允许变更的字段后的副本。 */
      const strip = (row: object) =>
        Object.fromEntries(
          Object.entries(row).filter(([key]) => !(allowed as readonly string[]).includes(key))
        )
      if (!equal(strip(old), strip(next!))) fail()
      if ('sourceType' in old) {
        const record = next as MobileSnapshot['records'][number]
        const touched = record.manualContent !== undefined
        if (touched && old.sourceType !== 'manual') fail()
        if (
          !touched &&
          !equal(
            { updatedAt: old.updatedAt, playDate: old.playDate, dateSource: old.dateSource },
            { updatedAt: record.updatedAt, playDate: record.playDate, dateSource: record.dateSource }
          )
        )
          fail()
      }
    }
  }
  return restoreTableBodies(proposed, current)
}
