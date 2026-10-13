import type { CharacterData, ModuleRecord, SessionRecord } from '../../../src/shared/types'
import type { MobileSnapshot } from './types'
import type { LogbookPort } from './native'
import { previewBackup } from './backup'

export type Edit =
  | { kind: 'module'; value: ModuleRecord }
  | { kind: 'record'; value: SessionRecord }
  | { kind: 'character'; value: CharacterData }

/** Build a new snapshot without mutating loaded data; retain all unrelated entities and body fields. */
export async function applyEdit(current: MobileSnapshot, edit: Edit): Promise<MobileSnapshot> {
  const next: MobileSnapshot = JSON.parse(JSON.stringify(current))
  const now = new Date().toISOString()
  if (edit.kind === 'module') {
    if (!edit.value.name.trim()) throw new Error('请填写模组名称。')
    const old = next.modules.find((m) => m.id === edit.value.id)
    const value = {
      ...edit.value,
      name: edit.value.name.trim(),
      createdAt: old?.createdAt ?? now,
      updatedAt: now
    }
    next.modules = old ? next.modules.map((m) => (m.id === value.id ? value : m)) : [...next.modules, value]
  } else if (edit.kind === 'record') {
    if (!edit.value.name.trim()) throw new Error('请填写场次名称。')
    if (!Number.isInteger(edit.value.sequenceNo) || edit.value.sequenceNo < 0)
      throw new Error('场次序号须为非负整数。')
    const old = next.records.find((r) => r.id === edit.value.id)
    if (old && (old.link !== edit.value.link || old.sourceType !== edit.value.sourceType))
      throw new Error('本阶段编辑不更改日志来源。')
    const value = {
      ...edit.value,
      name: edit.value.name.trim(),
      createdAt: old?.createdAt ?? now,
      updatedAt: now
    }
    if (old) {
      value.rawContent = old.rawContent
      value.cacheSourceUrl = old.cacheSourceUrl
      value.fetchedAt = old.fetchedAt
      if (old.sourceType === 'online') value.manualContent = old.manualContent
    }
    next.records = old ? next.records.map((r) => (r.id === value.id ? value : r)) : [...next.records, value]
  } else {
    if (!edit.value.basic.name.trim()) throw new Error('请填写角色姓名。')
    const old = next.characters.find((c) => c.id === edit.value.id)
    if (old && old.edition !== edit.value.edition) throw new Error('本阶段不转换已有角色版次。')
    const value = {
      ...edit.value,
      basic: { ...edit.value.basic, name: edit.value.basic.name.trim() },
      createdAt: old?.createdAt ?? now,
      updatedAt: now
    }
    next.characters = old
      ? next.characters.map((c) => (c.id === value.id ? value : c))
      : [...next.characters, value]
  }
  next.exportedAt = now
  return (await previewBackup(new TextEncoder().encode(JSON.stringify(next)))).snapshot
}

export async function saveEdit(
  port: Pick<LogbookPort, 'commitEdit'>,
  current: MobileSnapshot,
  edit: Edit,
  revision: number
) {
  const next = await applyEdit(current, edit)
  return port.commitEdit({
    json: JSON.stringify(next),
    expectedRevision: revision
  })
}
