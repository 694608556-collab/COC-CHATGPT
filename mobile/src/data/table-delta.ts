import type { MobileSnapshot } from './types'
import { mergeTableImport, tablePreviewBaseline } from './table-preview'

/** Complete changed entities, never arbitrary patches or native-owned bodies. */
export interface TableDelta {
  protocolVersion: 1
  initialSettings: MobileSnapshot['settings']
  modulesAdded: MobileSnapshot['modules']
  moduleParticipants: MobileSnapshot['modules']
  charactersAdded: MobileSnapshot['characters']
  recordsAdded: MobileSnapshot['records']
  manualUpdates: MobileSnapshot['records']
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>
  const keys = Object.keys(x).filter((k) => x[k] !== undefined)
  return (
    keys.length === Object.keys(y).filter((k) => y[k] !== undefined).length &&
    keys.every((k) => jsonEqual(x[k], y[k]))
  )
}

/** Called after complete Worker validation; reconstruction proves no change was omitted. */
export function createTableDelta(before: MobileSnapshot, after: MobileSnapshot): TableDelta {
  mergeTableImport(after, before)
  const delta: TableDelta = {
    protocolVersion: 1,
    initialSettings: after.settings,
    modulesAdded: after.modules.slice(before.modules.length),
    moduleParticipants: after.modules
      .slice(0, before.modules.length)
      .filter((r, i) => !jsonEqual(r, before.modules[i])),
    charactersAdded: after.characters.slice(before.characters.length),
    recordsAdded: after.records.slice(before.records.length),
    manualUpdates: after.records.slice(0, before.records.length).filter((r) => r.manualContent !== undefined)
  }
  if (!jsonEqual(applyTableDelta(delta, before, after.exportedAt), after))
    throw new Error('表格差量与完整预览不一致。')
  return delta
}

/** Development adapter/reference implementation. Native implementations independently validate. */
export function applyTableDelta(
  delta: TableDelta,
  current: MobileSnapshot | undefined,
  exportedAt: string
): MobileSnapshot {
  const fail = (): never => {
    throw new Error('表格差量不合法；未保存。')
  }
  if (
    !delta ||
    delta.protocolVersion !== 1 ||
    !jsonEqual(
      Object.keys(delta).sort(),
      [
        'protocolVersion',
        'initialSettings',
        'modulesAdded',
        'moduleParticipants',
        'charactersAdded',
        'recordsAdded',
        'manualUpdates'
      ].sort()
    )
  )
    fail()
  const baseline = current
    ? tablePreviewBaseline(current)
    : {
        schemaVersion: 2 as const,
        exportedAt,
        settings: delta.initialSettings,
        modules: [],
        characters: [],
        records: []
      }
  if (!jsonEqual(delta.initialSettings, baseline.settings)) fail()
  function merge<T extends { id: string }>(old: T[], added: T[], changed: T[]): T[] {
    if (!Array.isArray(added) || !Array.isArray(changed)) fail()
    const positions = new Map(old.map((r, i) => [r.id, i])),
      seen = new Set<string>(),
      result = [...old]
    for (const r of changed) {
      if (!r || typeof r.id !== 'string' || seen.has(r.id) || !positions.has(r.id)) fail()
      seen.add(r.id)
      result[positions.get(r.id)!] = r
    }
    for (const r of added) {
      if (!r || typeof r.id !== 'string' || !r.id || seen.has(r.id) || positions.has(r.id)) fail()
      seen.add(r.id)
      result.push(r)
    }
    return result
  }
  if (
    !Array.isArray(delta.manualUpdates) ||
    delta.manualUpdates.some((r) => !r || r.sourceType !== 'manual' || typeof r.manualContent !== 'string')
  )
    fail()
  const next: MobileSnapshot = {
    ...baseline,
    exportedAt,
    modules: merge(baseline.modules, delta.modulesAdded, delta.moduleParticipants),
    characters: merge(baseline.characters, delta.charactersAdded, []),
    records: merge(baseline.records, delta.recordsAdded, delta.manualUpdates)
  }
  return mergeTableImport(next, current)
}
