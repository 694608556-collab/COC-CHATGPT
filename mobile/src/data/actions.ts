import type { MobileSnapshot } from './types'
import { previewBackup } from './backup'
export type DataAction =
  | { type: 'delete'; kind: 'module' | 'record' | 'character'; id: string }
  | { type: 'reorder'; kind: 'module' | 'record'; id: string; targetId: string }
  | { type: 'realign'; moduleId: string }
  | { type: 'reset'; id: string }
  | { type: 'clear' }

export async function applyAction(current: MobileSnapshot, action: DataAction): Promise<MobileSnapshot> {
  const next: MobileSnapshot = JSON.parse(JSON.stringify(current))
  if (action.type === 'delete') {
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
    rows.forEach((r, i) => {
      r.order = i
    })
  } else if (action.type === 'realign') {
    next.records
      .filter((r) => r.moduleId === action.moduleId)
      .sort((a, b) => a.order - b.order)
      .forEach((r, i) => {
        r.sequenceNo = i + 1
      })
  } else if (action.type === 'reset') {
    next.records = next.records.map((r) =>
      r.id === action.id && r.sourceType === 'online'
        ? { ...r, previousStatus: r.status, status: 'pending', lastError: undefined }
        : r
    )
  } else {
    next.modules = []
    next.records = []
    next.characters = []
  }
  next.exportedAt = new Date().toISOString()
  return (await previewBackup(new TextEncoder().encode(JSON.stringify(next)))).snapshot
}
