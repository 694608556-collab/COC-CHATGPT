import { expect, it, vi } from 'vitest'
import { importTable } from './tables'
import { searchSample } from '../dev/sample'

it('300模组6000场表格预览只线性访问已有场次，末行和重复链接保持正确', async () => {
  const base = searchSample()
  const count = 6000
  const lines = ['模组名,场次名,海豹链接,手动保存内容']
  for (let i = 0; i < count; i++)
    lines.push(
      `公开规模模组${Math.floor(i / 20)},第${(i % 20) + 1}场,https://log.weizaima.com/?key=scale-${i},`
    )
  lines.push('公开规模模组299,重复末场,https://log.weizaima.com/?key=scale-5999,')
  const started = performance.now()
  let visits = 0
  const original = Array.prototype.filter
  // 对真实导入链计数，避免以机器速度作为复杂度门槛；不替换导入结果。
  const spy = vi.spyOn(Array.prototype, 'filter').mockImplementation(function (
    this: unknown[],
    callback,
    thisArg
  ) {
    return original.call(this, (value, index, array) => {
      if (value && typeof value === 'object' && 'moduleId' in value && 'sourceType' in value) visits++
      return callback.call(thisArg, value, index, array)
    })
  })
  try {
    const result = await importTable(
      { ...base, modules: [], records: [], characters: [] },
      new TextEncoder().encode(lines.join('\n')),
      'public-scale.csv',
      'records'
    )
    expect(result.next.modules).toHaveLength(300)
    expect(result.next.records).toHaveLength(count)
    expect(result.next.records.at(-1)).toMatchObject({ name: '第20场', sequenceNo: 20 })
    expect(result.warnings.join('')).toContain('来源已存在')
    expect(visits).toBeLessThan(count * 20)
    console.info(
      JSON.stringify({
        publicTableRows: count,
        modules: 300,
        recordFilterVisits: visits,
        previewMs: Math.round(performance.now() - started)
      })
    )
  } finally {
    spy.mockRestore()
  }
})

it('索引保留同名歧义、文件内唯一更新和首个同名模组规则', async () => {
  const base = searchSample()
  const module = { ...base.modules[0]!, name: '公开同名模组' }
  const first = { ...base.records[1]!, moduleId: module.id, name: '同名手动', link: undefined }
  const second = { ...first, id: 'public-second', manualContent: '第二条原文' }
  const current = {
    ...base,
    modules: [module, { ...module, id: 'public-other' }],
    records: [first, second],
    characters: []
  }
  const result = await importTable(
    current,
    new TextEncoder().encode(
      '模组名,场次名,手动保存内容\n公开同名模组,同名手动,不得覆盖歧义\n公开同名模组,新手动,第一版\n公开同名模组,新手动,第二版'
    ),
    'public-duplicates.csv',
    'records'
  )
  expect(result.next.records).toHaveLength(4)
  expect(result.next.records[0]!.manualContent).toBe(first.manualContent)
  expect(result.next.records[1]!.manualContent).toBe('第二条原文')
  expect(result.next.records[2]!.moduleId).toBe(module.id)
  expect(result.next.records[3]).toMatchObject({ manualContent: '第二版', sequenceNo: 4 })
  expect(result.updated).toBe(1)
  expect(current.records).toHaveLength(2)
})
