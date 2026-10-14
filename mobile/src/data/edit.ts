import type { CharacterData, ModuleRecord, SessionRecord } from '../../../src/shared/types'
import type { MobileSnapshot } from './types'
import type { LogbookPort } from './native'
import { previewBackup } from './backup'
import { sessionNameFor } from '../../../src/shared/session-number'

export type Edit =
  | { kind: 'module'; value: ModuleRecord }
  | { kind: 'record'; value: SessionRecord }
  | { kind: 'character'; value: CharacterData }

/**
 * 构造不修改原数据的编辑快照；场次空名沿用桌面共享默认取名规则。
 * @param current - 已校验的数据，未编辑实体与正文保留。
 * @param edit - 用户确认保存的编辑草稿。
 * @returns 校验后的新快照；场次名留空时按当前序号生成“第 N 场”。
 */
export async function applyEdit(current: MobileSnapshot, edit: Edit): Promise<MobileSnapshot> {
  const next: MobileSnapshot = { ...current }
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
    if (!Number.isInteger(edit.value.sequenceNo) || edit.value.sequenceNo < 0)
      throw new Error('场次序号须为非负整数。')
    const old = next.records.find((r) => r.id === edit.value.id)
    const value = {
      ...edit.value,
      name:
        edit.value.name.trim() ||
        sessionNameFor(
          next.modules.find((m) => m.id === edit.value.moduleId)?.name ?? '',
          edit.value.sequenceNo
        ),
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
        let url: URL
        try {
          url = new URL(value.link ?? '')
        } catch {
          throw new Error('请输入包含 key 参数的完整海豹日志网址。')
        }
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
  // 未改动的正文已在读取边界校验。只校验本次实体和全部关联，避免改名扫描每场正文。
  const checked = (
    await previewBackup(
      new TextEncoder().encode(
        JSON.stringify({
          ...next,
          records: edit.kind === 'record' ? next.records.filter((row) => row.id === edit.value.id) : []
        })
      )
    )
  ).snapshot
  return {
    ...next,
    modules: checked.modules,
    characters: checked.characters,
    records:
      edit.kind === 'record'
        ? next.records.map((row) => (row.id === edit.value.id ? checked.records[0]! : row))
        : next.records
  }
}

/**
 * 保存校验后的编辑，并仅在存储确认后返回同一候选供界面展示，避免即时全量重读。
 * @param port - 持久化边界，负责版本检查、授权及事务；模组使用小请求。
 * @param current - 当前已读取的快照，不原地修改。
 * @param edit - 待保存草稿。
 * @param revision - 打开编辑时的持久化版本。
 * @returns 已提交版本与候选快照；模组不缓存大 JSON，失败不返回候选。
 */
export async function saveEdit(
  port: Pick<LogbookPort, 'commitEdit' | 'commitModule'>,
  current: MobileSnapshot,
  edit: Edit,
  revision: number
) {
  const next = await applyEdit(current, edit)
  if (edit.kind === 'module') {
    const result = await port.commitModule({
      value: next.modules.find((row) => row.id === edit.value.id)!,
      expectedRevision: revision
    })
    const snapshot = {
      ...next,
      exportedAt: result.exportedAt,
      modules: next.modules.map((row) =>
        row.id === edit.value.id ? { ...row, updatedAt: result.exportedAt } : row
      )
    }
    return { ...result, snapshot, json: null, safetyBackup: undefined }
  }
  const json = JSON.stringify(next)
  const result = await port.commitEdit({
    json,
    expectedRevision: revision
  })
  return { ...result, snapshot: next, json }
}
