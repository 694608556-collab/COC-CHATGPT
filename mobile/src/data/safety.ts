import type { MobileSnapshot } from './types'

/** 普通编辑保护窗口长度，单位毫秒；危险变更不使用该窗口。 */
export const ORDINARY_SAFETY_WINDOW_MS = 10 * 60 * 1000

/**
 * 根据前后实际实体变化判定副本等级，不接受客户端“跳过保护”标记。
 * @param before - 当前已保存快照；首次无数据时为 null。
 * @param next - 已校验的候选快照。
 * @returns settings 不需完整副本、ordinary 合并窗口、always 逐次保护。
 */
export function safetyLevel(
  before: MobileSnapshot | null,
  next: MobileSnapshot
): 'settings' | 'ordinary' | 'always' {
  if (!before)
    return next.modules.length || next.records.length || next.characters.length ? 'ordinary' : 'settings'
  if (
    (['modules', 'records', 'characters'] as const).every(
      (key) => JSON.stringify(before[key]) === JSON.stringify(next[key])
    )
  )
    return 'settings'
  for (const key of ['modules', 'records', 'characters'] as const) {
    const ids = new Set(next[key].map((row) => row.id))
    if (before[key].some((row) => !ids.has(row.id))) return 'always'
  }
  const records = new Map(next.records.map((row) => [row.id, row]))
  if (
    before.records.some((row) => {
      const target = records.get(row.id)
      return target && (row.sourceType !== target.sourceType || (row.link ?? '') !== (target.link ?? ''))
    })
  )
    return 'always'
  return 'ordinary'
}
