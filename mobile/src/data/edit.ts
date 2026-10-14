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
    const value = {
      ...edit.value,
      name: edit.value.name.trim(),
      createdAt: old?.createdAt ?? now,
      updatedAt: now
    }
    if (old && old.link === value.link && old.sourceType === value.sourceType) {
      value.rawContent = old.rawContent
      value.cacheSourceUrl = old.cacheSourceUrl
      value.fetchedAt = old.fetchedAt
      if (old.sourceType === 'online') value.manualContent = old.manualContent
    } else if (old) {
      value.rawContent = undefined
      value.cacheSourceUrl = undefined
      value.fetchedAt = undefined
      value.lastError = undefined
      value.status = value.sourceType === 'manual' ? 'manual' : 'pending'
    }
    if (value.sourceType === 'online') {
      if (!old || old.link !== value.link || old.sourceType !== value.sourceType) {
        const url = new URL(value.link ?? '')
        if (
          url.hostname !== 'log.weizaima.com' ||
          !['http:', 'https:'].includes(url.protocol) ||
          !url.searchParams.get('key') ||
          url.username ||
          url.password ||
          url.port
        )
          throw new Error('请输入包含 key 参数的完整海豹日志网址。')
      }
      if (
        next.records.some((r) => r.id !== value.id && r.moduleId === value.moduleId && r.link === value.link)
      )
        throw new Error('同一模组已有此来源链接，请编辑已有场次。')
      value.manualContent = undefined
    }
    next.records = old ? next.records.map((r) => (r.id === value.id ? value : r)) : [...next.records, value]
  } else {
    if (!edit.value.basic.name.trim()) throw new Error('请填写角色姓名。')
    const old = next.characters.find((c) => c.id === edit.value.id)
    const value = {
      ...edit.value,
      basic: { ...edit.value.basic, name: edit.value.basic.name.trim() },
      createdAt: old?.createdAt ?? now,
      updatedAt: now
    }
    next.characters = old
      ? next.characters.map((c) => (c.id === value.id ? value : c))
      : [...next.characters, value]
    value.moduleIds = [...new Set(value.moduleIds)]
    value.moduleId = value.moduleIds[0]
    next.modules = next.modules.map((m) => ({
      ...m,
      pairs: m.pairs.map((p) =>
        p.characterId === value.id
          ? value.moduleIds.includes(m.id)
            ? { ...p, pc: value.basic.name }
            : { pc: p.pc, pl: p.pl }
          : p
      )
    }))
  }
  if (edit.kind === 'module') {
    const linked = edit.value.pairs.flatMap((p) => (p.characterId ? [p.characterId] : []))
    next.characters = next.characters.map((c) =>
      linked.includes(c.id)
        ? {
            ...c,
            moduleIds: [...new Set([...c.moduleIds, edit.value.id])],
            moduleId: c.moduleId ?? edit.value.id
          }
        : c
    )
    next.modules = next.modules.map((m) =>
      m.id === edit.value.id
        ? {
            ...m,
            kps: m.kps.map((s) => s.trim()).filter(Boolean),
            pairs: m.pairs.map((p) =>
              p.characterId
                ? { ...p, pc: next.characters.find((c) => c.id === p.characterId)?.basic.name ?? p.pc }
                : p
            )
          }
        : m
    )
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
