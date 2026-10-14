import { describe, expect, it } from 'vitest'
import { applyEdit, saveEdit } from './edit'
import { exampleBackup } from './fixtures'
import { previewBackup } from './backup'
import { createEmptyCharacter, convertCharacterEdition } from '../../../src/shared/coc-rules'
import type { LogbookPort } from './native'

const load = async () =>
  (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
describe('编辑数据保护', () => {
  it('模组小请求不编码未改正文，保存确认后返回完整未改内容', async () => {
    const current = await load()
    const body = current.records[0]!.rawContent!
    Object.defineProperty(body, 'toJSON', {
      value: () => {
        throw new Error('未改正文被重复编码')
      }
    })
    const port = {
      commitEdit: async () => {
        throw new Error('模组不应提交完整正文')
      },
      commitModule: async (options: { value: unknown; expectedRevision: number }) => {
        expect(options.expectedRevision).toBe(7)
        expect(JSON.stringify(options.value)).not.toContain('离线正文')
        return { revision: 8, exportedAt: '2026-10-15T00:00:00Z' }
      }
    }
    const result = await saveEdit(
      port,
      current,
      { kind: 'module', value: { ...current.modules[0]!, name: '快速改名' } },
      7
    )
    expect(result.snapshot.modules[0]!.name).toBe('快速改名')
    expect(result.snapshot.records[0]!.rawContent!.messages[0]!.text).toBe('离线正文')
    expect(current.modules[0]!.name).not.toBe('快速改名')
  })
  it('手填伤害加值保存原文，移除公式入口后旧公式不阻止其他字段保存', async () => {
    const current = await load()
    const character = createEmptyCharacter({ edition: 7, name: '手填伤害测试' })
    character.occupationFormula = '旧自定义公式'
    character.derived.db = '+2D6（手填）'
    current.characters = [character]
    const next = await applyEdit(current, { kind: 'character', value: { ...character, items: ['钱包'] } })
    expect(next.characters[0]?.derived.db).toBe('+2D6（手填）')
    expect(next.characters[0]?.occupationFormula).toBe('旧自定义公式')
    expect(next.characters[0]?.items).toEqual(['钱包'])
    expect(current.characters[0]?.items).toEqual([])
  })
  it('编辑在线场次名称保留正文、来源及无关数据，原快照不变', async () => {
    const current = await load()
    const before = JSON.stringify(current)
    const record = current.records[0]!
    const next = await applyEdit(current, {
      kind: 'record',
      value: { ...record, name: '新场次名', rawContent: undefined }
    })
    expect(next.records[0]?.rawContent).toEqual(record.rawContent)
    expect(next.records[0]?.link).toBe(record.link)
    expect(next.modules).toEqual(current.modules)
    expect(JSON.stringify(current)).toBe(before)
    await expect(
      applyEdit(current, {
        kind: 'record',
        value: { ...record, link: 'https://example.org/changed' }
      })
    ).rejects.toThrow('海豹')
  })
  it('场次名留空采用电脑端默认命名，保留正文、序号和原数据', async () => {
    const current = await load()
    const record = current.records[0]!
    const before = JSON.stringify(current)
    const next = await applyEdit(current, { kind: 'record', value: { ...record, name: '  ' } })
    expect(next.records[0]?.name).toBe('第 1 场')
    expect(next.records[0]?.sequenceNo).toBe(1)
    expect(next.records[0]?.rawContent).toEqual(record.rawContent)
    expect(JSON.stringify(current)).toBe(before)
  })
  it('拒绝孤立场次与无效序号', async () => {
    const current = await load()
    const record = current.records[0]!
    await expect(
      applyEdit(current, {
        kind: 'record',
        value: { ...record, moduleId: 'missing' }
      })
    ).rejects.toThrow('关联')
    await expect(
      applyEdit(current, {
        kind: 'record',
        value: { ...record, sequenceNo: -1 }
      })
    ).rejects.toThrow('序号')
  })
  it('无效海豹网址显示中文提示且保留已有正文和原快照', async () => {
    const current = await load()
    const before = JSON.stringify(current)
    await expect(
      applyEdit(current, { kind: 'record', value: { ...current.records[0]!, link: '111111' } })
    ).rejects.toThrow('请输入包含 key 参数的完整海豹日志网址')
    expect(JSON.stringify(current)).toBe(before)
  })
  it('角色编辑保留隐藏技能、武器、版次快照及模组关联', async () => {
    const current = await load()
    const c = createEmptyCharacter({
      edition: 6,
      moduleId: 'm1',
      name: '公开角色'
    })
    c.skills[0]!.hidden = true
    c.weapons = [{ name: '公开装备', damage: '1D4' }]
    current.characters = [c]
    const next = await applyEdit(current, {
      kind: 'character',
      value: { ...c, basic: { ...c.basic, name: '修改后' } }
    })
    expect(next.characters[0]).toMatchObject({
      weapons: c.weapons,
      skills: c.skills,
      moduleIds: ['m1'],
      editionSnapshots: c.editionSnapshots
    })
    const converted = await applyEdit(current, { kind: 'character', value: convertCharacterEdition(c, 7) })
    expect(converted.characters[0]?.attrs.STR).toBe(50)
    expect(converted.characters[0]?.editionSnapshots[6]?.STR).toBe(10)
  })
  it('持久化失败不修改已加载快照，版本序号传到存储边界', async () => {
    const current = await load()
    const before = JSON.stringify(current)
    const port = {
      commitModule: async (options: { expectedRevision: number }) => {
        expect(options.expectedRevision).toBe(9)
        throw new Error('存储失败')
      },
      commitEdit: async (options: { expectedRevision: number }) => {
        expect(options.expectedRevision).toBe(9)
        throw new Error('安全副本失败')
      }
    } satisfies Pick<LogbookPort, 'commitEdit' | 'commitModule'>
    await expect(
      saveEdit(port, current, { kind: 'module', value: { ...current.modules[0]!, name: '修改' } }, 9)
    ).rejects.toThrow('存储失败')
    expect(JSON.stringify(current)).toBe(before)
  })
})
