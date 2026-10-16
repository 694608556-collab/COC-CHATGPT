import { expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
import { createRecordTableExport } from './table-export'
import { searchSample } from '../dev/sample'
import { createExport } from './export'

it('单场与合成导出使用电脑名称，原始消息与手动正文不丢失', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-16T04:00:00Z'))
  try {
    const sample = searchSample(),
      module = sample.modules[0]!,
      record = { ...sample.records[0]!, name: '第 4 场', playDate: '2026-05-06' }
    module.name = '模组甲'
    expect((await createExport(module, [record], sample.settings.filterPreset, 'txt')).name).toBe(
      '20260506模组甲第 4 场.txt'
    )
    const raw = await createExport(module, [record], sample.settings.filterPreset, 'raw')
    expect(raw.name).toBe('20260506模组甲第 4 场原始.json')
    expect(JSON.parse(new TextDecoder().decode(raw.bytes)).messages).toEqual(record.rawContent!.messages)
    const combined = await createExport(
      module,
      [record, sample.records[1]!],
      sample.settings.filterPreset,
      'txt',
      true
    )
    expect(combined.name).toBe('20261016模组甲合集.txt')
    expect(new TextDecoder().decode(combined.bytes)).toContain(sample.records[1]!.manualContent)
  } finally {
    vi.useRealTimers()
  }
})

it('多模组 CSV 与电脑同名 ZIP，同名 CSV 分别编号，不覆盖任何模组；单模组保持 CSV', () => {
  const sample = searchSample()
  sample.modules[0]!.name = '同名模组'
  sample.modules[1]!.name = '同名模组'
  const zip = createRecordTableExport(sample, 'csv')
  expect(zip.name).toMatch(/^COC跑团记录\d{8}\.zip$/)
  const entries = unzipSync(zip.bytes)
  expect(Object.keys(entries)).toEqual(['同名模组.csv', '同名模组 (2).csv'])
  expect(new TextDecoder().decode(entries['同名模组.csv'])).toContain('第一场：灯塔线索')
  expect(new TextDecoder().decode(entries['同名模组 (2).csv'])).toContain('第三场：旅馆访谈')
  sample.records = sample.records.filter((r) => r.moduleId === sample.modules[0]!.id)
  expect(createRecordTableExport(sample, 'csv').name).toMatch(/^COC跑团记录\d{8}\.csv$/)
  expect(createRecordTableExport(sample, 'xlsx').name).toMatch(/^COC跑团记录\d{8}\.xlsx$/)
})
