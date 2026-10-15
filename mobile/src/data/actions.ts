import type { MobileSnapshot } from './types'
/** 用户确认后一次提交的场次删除命令，不影响模组、角色或归档文件。 */
interface BatchRecordDeletion {
  /** 操作白名单标识，类型为字面量 delete-records。 */
  type: 'delete-records'
  /** 已选场次 ID，类型为 string[]；必须非空、唯一且全部仍然存在。 */
  ids: string[]
}
export type DataAction =
  | BatchRecordDeletion
  | { type: 'delete'; kind: 'module' | 'record' | 'character'; id: string }
  | { type: 'reorder'; kind: 'module' | 'record'; id: string; targetId: string }
  | { type: 'reset'; id: string }
  | { type: 'clear' }

/**
 * 对已校验的本机快照应用列表操作，不复制或重新校验未变化的正文。
 * @param current - 通过导入/读取边界校验的快照；不会修改其中的实体。
 * @param action - 删除、排序、状态重置或清空操作。
 * @returns 新快照；仅复制有变更的实体，正文保持原有内容。
 */
export async function applyAction(current: MobileSnapshot, action: DataAction): Promise<MobileSnapshot> {
  const next: MobileSnapshot = { ...current }
  if (action.type === 'delete-records') {
    if (!Array.isArray(action.ids) || !action.ids.length) throw new Error('至少选择一个场次。')
    const ids = new Set(action.ids)
    if (ids.size !== action.ids.length) throw new Error('场次选择无效，请重新选择。')
    // Build once: validating a large selection must not scan the entire record list per target.
    const existing = new Set(current.records.map((record) => record.id))
    for (const id of ids) {
      if (typeof id !== 'string' || !existing.has(id)) throw new Error('目标已不存在，请重新读取。')
    }
    next.records = current.records.filter((r) => !ids.has(r.id))
  } else if (action.type === 'delete') {
    if (action.kind === 'module') {
      next.modules = next.modules.filter((m) => m.id !== action.id)
      next.records = next.records.filter((r) => r.moduleId !== action.id)
      next.characters = next.characters.map((c) => {
        const moduleIds = c.moduleIds.filter((id) => id !== action.id)
        return { ...c, moduleIds, moduleId: moduleIds[0] }
      })
    } else if (action.kind === 'record') next.records = next.records.filter((r) => r.id !== action.id)
    else {
      next.characters = next.characters.filter((c) => c.id !== action.id)
      next.modules = next.modules.map((m) => ({
        ...m,
        pairs: m.pairs.map((p) => (p.characterId === action.id ? { pc: p.pc, pl: p.pl } : p))
      }))
    }
  } else if (action.type === 'reorder') {
    const source = action.kind === 'module' ? next.modules : next.records
    const selected = source.find((r) => r.id === action.id)
    if (!selected) throw new Error('目标已不存在，请重新读取。')
    const rows = source
      .filter(
        (r) =>
          action.kind === 'module' ||
          ('moduleId' in r && 'moduleId' in selected && r.moduleId === selected.moduleId)
      )
      .sort((a, b) => a.order - b.order)
    const index = rows.findIndex((r) => r.id === action.id)
    const other = rows.findIndex((r) => r.id === action.targetId)
    if (other < 0) throw new Error('只能在同一列表内排序，请重新读取。')
    const [moved] = rows.splice(index, 1)
    rows.splice(other, 0, moved!)
    const order = new Map(rows.map((row, index) => [row.id, index]))
    if (action.kind === 'module')
      next.modules = next.modules.map((row) => ({ ...row, order: order.get(row.id)! }))
    else
      next.records = next.records.map((row) =>
        order.has(row.id) ? { ...row, order: order.get(row.id)! } : row
      )
  } else if (action.type === 'reset') {
    next.records = next.records.map((r) =>
      r.id === action.id && r.sourceType === 'online'
        ? { ...r, previousStatus: r.status, status: 'pending', lastError: undefined }
        : r
    )
  } else if (action.type === 'clear') {
    next.modules = []
    next.records = []
    next.characters = []
  } else throw new Error('不支持此列表操作。')
  next.exportedAt = new Date().toISOString()
  return next
}
