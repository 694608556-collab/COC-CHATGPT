import { describe, expect, it } from 'vitest'
import { applyAction } from './actions'
import { applyEdit } from './edit'
import { searchSample } from '../dev/sample'
import { createEmptyCharacter } from '../../../src/shared/coc-rules'
describe('删除、排序与关联完整性', () => {
  it('删除模组级联场次、解除角色归属，原快照不变', async () => {
    const current = searchSample()
    const c = createEmptyCharacter({
      edition: 7,
      name: '公开角色',
      moduleIds: current.modules.map((m) => m.id)
    })
    current.characters = [c]
    const before = JSON.stringify(current)
    const next = await applyAction(current, { type: 'delete', kind: 'module', id: current.modules[0]!.id })
    expect(next.records).toHaveLength(2)
    expect(next.characters[0]?.moduleIds).toEqual([current.modules[1]!.id])
    expect(JSON.stringify(current)).toBe(before)
  })
  it('绑定、改名、移除归属及删除角色保留 PC/PL 姓名', async () => {
    const current = searchSample()
    const c = createEmptyCharacter({ edition: 7, name: '林', moduleIds: [] })
    current.characters = [c]
    const linked = await applyEdit(current, {
      kind: 'module',
      value: { ...current.modules[0]!, pairs: [{ pc: '旧名字', pl: '玩家', characterId: c.id }] }
    })
    expect(linked.characters[0]?.moduleIds).toContain(current.modules[0]!.id)
    expect(linked.modules[0]?.pairs[0]?.pc).toBe('林')
    const renamed = await applyEdit(linked, {
      kind: 'character',
      value: { ...linked.characters[0]!, basic: { ...c.basic, name: '林二' } }
    })
    expect(renamed.modules[0]?.pairs[0]?.pc).toBe('林二')
    const deleted = await applyAction(renamed, { type: 'delete', kind: 'character', id: c.id })
    expect(deleted.modules[0]?.pairs[0]).toEqual({ pc: '林二', pl: '玩家' })
    const detached = await applyEdit(renamed, {
      kind: 'character',
      value: { ...renamed.characters[0]!, moduleIds: [] }
    })
    expect(detached.modules[0]?.pairs[0]?.characterId).toBeUndefined()
  })
  it('换来源使旧正文失效，排序和序号只影响当前模组', async () => {
    const current = searchSample()
    const changed = await applyEdit(current, {
      kind: 'record',
      value: { ...current.records[0]!, link: 'https://log.weizaima.com/?key=changed' }
    })
    expect(changed.records[0]?.rawContent).toBeUndefined()
    expect(changed.records[0]?.status).toBe('pending')
    const moved = await applyAction(current, {
      type: 'move',
      kind: 'record',
      id: current.records[0]!.id,
      direction: 1
    })
    const numbered = await applyAction(moved, { type: 'realign', moduleId: current.modules[0]!.id })
    expect(numbered.records[0]?.sequenceNo).toBe(2)
    expect(numbered.records[2]?.order).toBe(current.records[2]?.order)
  })
})
