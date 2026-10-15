import { describe, expect, it } from 'vitest'
import { applyAction } from './actions'
import type { DataAction } from './actions'
import { applyEdit } from './edit'
import { searchSample } from '../dev/sample'
import { createEmptyCharacter } from '../../../src/shared/coc-rules'
describe('删除、排序与关联完整性', () => {
  it('批量删除的目标核对按场次数量线性增长，保留未选正文且不更改原数组', async () => {
    const current = searchSample(),
      template = current.records[0]!
    let reads = 0
    current.records = Array.from({ length: 1000 }, (_, index) => ({
      ...template,
      get id() {
        reads++
        return `batch-${index}`
      }
    }))
    const before = current.records
    const selected = Array.from({ length: 999 }, (_, index) => `batch-${index}`)
    const next = await applyAction(current, { type: 'delete-records', ids: selected })
    expect(reads).toBeLessThanOrEqual(current.records.length * 4)
    expect(next.records).toEqual([before[999]])
    expect(next.records[0]!.rawContent).toBe(template.rawContent)
    expect(current.records).toBe(before)
    for (const ids of [[], ['batch-0', 'batch-0'], ['batch-0', 'missing']]) {
      await expect(applyAction(current, { type: 'delete-records', ids })).rejects.toThrow()
      expect(current.records).toBe(before)
      expect(current.records).toHaveLength(1000)
    }
  })
  it('75 场大正文排序及时完成，保留正文且不改动原顺序', async () => {
    const current = searchSample()
    const template = current.records[0]!
    current.records = Array.from({ length: 75 }, (_, order) => ({
      ...template,
      id: 'large-' + order,
      name: '公开性能场次 ' + order,
      order,
      rawContent: {
        ...template.rawContent!,
        messages: Array.from({ length: 324 }, (_, index) => ({
          ...template.rawContent!.messages[0]!,
          id: order + '-' + index,
          text: '公开性能正文。'.repeat(30),
          raw: { text: '公开原始字段。'.repeat(30) }
        }))
      }
    }))
    const started = performance.now()
    const next = await applyAction(current, {
      type: 'reorder',
      kind: 'record',
      id: 'large-0',
      targetId: 'large-74'
    })
    expect(performance.now() - started).toBeLessThan(150)
    expect(next.records.slice().sort((a, b) => a.order - b.order)[0]!.id).toBe('large-1')
    expect(next.records.find((record) => record.id === 'large-0')!.order).toBe(74)
    expect(next.records[0]!.rawContent!.messages[0]!.text).toBe('公开性能正文。'.repeat(30))
    expect(current.records[0]!.order).toBe(0)
  })
  it('拖动可跨多个位置一次排序，拒绝跨模组目标且不修改原快照', async () => {
    const current = searchSample()
    const first = current.records[0]!
    const second = current.records[1]!
    const third = { ...second, id: 'third-record', name: '第三场', order: 2 }
    current.records.push(third)
    const before = JSON.stringify(current)
    const next = await applyAction(current, {
      type: 'reorder',
      kind: 'record',
      id: first.id,
      targetId: third.id
    })
    expect(
      next.records
        .filter((r) => r.moduleId === first.moduleId)
        .sort((a, b) => a.order - b.order)
        .map((r) => r.id)
    ).toEqual([second.id, third.id, first.id])
    expect(JSON.stringify(current)).toBe(before)
    await expect(
      applyAction(current, {
        type: 'reorder',
        kind: 'record',
        id: first.id,
        targetId: current.records[2]!.id
      })
    ).rejects.toThrow('同一列表')
  })
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
  it('角色改名与归属不改动模组 PC/PL，删除角色只解除失效绑定', async () => {
    const current = searchSample()
    const c = createEmptyCharacter({ edition: 7, name: '林', moduleIds: [] })
    current.characters = [c]
    const linked = await applyEdit(current, {
      kind: 'module',
      value: { ...current.modules[0]!, pairs: [{ pc: '旧名字', pl: '玩家', characterId: c.id }] }
    })
    expect(linked.characters[0]?.moduleIds).toContain(current.modules[0]!.id)
    expect(linked.modules[0]?.pairs[0]?.pc).toBe('旧名字')
    const renamed = await applyEdit(linked, {
      kind: 'character',
      value: { ...linked.characters[0]!, basic: { ...c.basic, name: '林二' } }
    })
    expect(renamed.modules).toEqual(linked.modules)
    const deleted = await applyAction(renamed, { type: 'delete', kind: 'character', id: c.id })
    expect(deleted.modules[0]?.pairs[0]).toEqual({ pc: '旧名字', pl: '玩家' })
    const detached = await applyEdit(renamed, {
      kind: 'character',
      value: { ...renamed.characters[0]!, moduleIds: [] }
    })
    expect(detached.modules).toEqual(linked.modules)
  })
  it('换来源使旧正文失效，排序只影响当前模组、不重写场次序号', async () => {
    const current = searchSample()
    const changed = await applyEdit(current, {
      kind: 'record',
      value: { ...current.records[0]!, link: 'https://log.weizaima.com/?key=changed' }
    })
    expect(changed.records[0]?.rawContent).toBeUndefined()
    expect(changed.records[0]?.status).toBe('pending')
    const moved = await applyAction(current, {
      type: 'reorder',
      kind: 'record',
      id: current.records[0]!.id,
      targetId: current.records[1]!.id
    })
    expect(moved.records.map((r) => r.sequenceNo)).toEqual(current.records.map((r) => r.sequenceNo))
    expect(moved.records[2]?.order).toBe(current.records[2]?.order)
  })
  it('清空只清业务实体、保留设置；移除的序号重排请求拒绝而非落入清空', async () => {
    const current = searchSample()
    const before = JSON.stringify(current)
    const cleared = await applyAction(current, { type: 'clear' })
    expect(cleared.modules).toEqual([])
    expect(cleared.records).toEqual([])
    expect(cleared.characters).toEqual([])
    expect(cleared.settings).toEqual(current.settings)
    await expect(
      applyAction(current, {
        type: 'realign',
        moduleId: current.modules[0]!.id
      } as unknown as DataAction)
    ).rejects.toThrow('不支持')
    expect(JSON.stringify(current)).toBe(before)
  })
})
