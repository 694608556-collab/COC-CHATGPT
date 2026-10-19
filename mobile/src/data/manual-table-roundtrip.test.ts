import { expect, it } from 'vitest'
import { createRecordTableExport } from './table-export'
import { importTable } from './tables'
import { searchSample } from '../dev/sample'
import { TABLE_TEMPLATE_HEADERS } from '../../../src/shared/table-import'
for (const format of ['csv', 'xlsx'] as const)
  it(`${format}保留长手动正文与人员`, async () => {
    const sample = searchSample()
    sample.modules = [sample.modules[0]!]
    sample.records = [
      {
        ...sample.records[1]!,
        moduleId: sample.modules[0]!.id,
        sourceType: 'manual',
        status: 'manual',
        manualContent: '公开正文😀\n'.repeat(8000) + '末段'
      }
    ]
    const file = createRecordTableExport(sample, format)
    const empty = { ...sample, modules: [], records: [], characters: [] }
    const result = await importTable(empty, file.bytes, file.name, 'records')
    expect(result.next.records[0]!.manualContent === sample.records[0]!.manualContent).toBe(true)
    expect(result.next.records[0]!.sourceType).toBe('manual')
    expect(result.next.modules[0]!.kps).toEqual(sample.modules[0]!.kps)
  })
it('空白模板正文列在KP左侧', () =>
  expect((TABLE_TEMPLATE_HEADERS as readonly string[]).indexOf('手动保存内容')).toBe(
    TABLE_TEMPLATE_HEADERS.indexOf('KP1') - 1
  ))

it('带链接的手动正文仍按手动场次导入，唯一同名更新在预览副本内', async () => {
  const current = searchSample()
  const row = current.records[1]!
  row.name = '公开手动场次'
  const bytes = new TextEncoder().encode(
    '模组名,场次名,海豹链接,手动保存内容,KP1\n' +
      current.modules[0]!.name +
      ',公开手动场次,,更新后的公开正文,公开KP'
  )
  const result = await importTable(current, bytes, 'manual.csv', 'records')
  expect(result.updated).toBe(1)
  expect(result.next.records.find((record) => record.id === row.id)!.manualContent).toBe('更新后的公开正文')
  expect(current.records.find((record) => record.id === row.id)!.manualContent).not.toBe('更新后的公开正文')
  expect(result.warnings.join('')).toContain('将更新')
  const withLink = await importTable(
    { ...current, modules: [], records: [], characters: [] },
    new TextEncoder().encode(
      '模组名,场次名,海豹链接,手动保存内容\n公开模块,第一场,https://log.weizaima.com/?key=manual,公开正文'
    ),
    'manual.csv',
    'records'
  )
  expect(withLink.next.records[0]).toMatchObject({
    sourceType: 'manual',
    status: 'manual',
    manualContent: '公开正文'
  })
})
