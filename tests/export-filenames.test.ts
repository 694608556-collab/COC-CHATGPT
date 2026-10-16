import { expect, it } from 'vitest'
import {
  recordExportName,
  combinedExportName,
  tableExportName,
  nextExportName,
  sanitizeExportName
} from '../src/shared/export-filenames'
import { sanitizeWindowsName, nextAvailableName } from '../src/shared/safe-path'

it('手机与桌面共用日期、模组、场次、格式后缀及合集命名', () => {
  const formats = {
    txt: 'txt',
    doc: '带图.doc',
    'dialogue-doc': '对话.doc',
    raw: '原始.json',
    docx: 'docx',
    pdf: 'pdf'
  } as const
  for (const [format, suffix] of Object.entries(formats)) {
    const end = ['txt', 'docx', 'pdf'].includes(format) ? '.' + suffix : suffix
    expect(recordExportName('模:组', '第 4 场', '2026-05-06', format as keyof typeof formats)).toBe(
      '20260506模＿组第 4 场' + end
    )
  }
  expect(recordExportName('模组', '场次', undefined, 'txt')).toBe('日期未知模组场次.txt')
  const date = new Date('2026-10-16T04:00:00Z')
  expect(combinedExportName('模组', 'txt', date)).toBe('20261016模组合集.txt')
  expect(tableExportName('xlsx', 2, date)).toBe('COC跑团记录20261016.xlsx')
  expect(tableExportName('csv', 1, date)).toBe('COC跑团记录20261016.csv')
  expect(tableExportName('csv', 2, date)).toBe('COC跑团记录20261016.zip')
})

it('Windows 清理规则不变，重复编号与电脑一致，原有文件名不受修改', () => {
  for (const name of ['a/b:c?.d', 'CON', 'NUL.txt', '前后空格 . ', '.', '文件..名', '😀'.repeat(70)])
    expect(sanitizeExportName(name)).toBe(sanitizeWindowsName(name))
  const existing = ['记录.txt', '记录 (2).TXT', '记录.版本.txt']
  for (const name of ['记录.txt', '记录.TXT', '记录.版本.txt', '新文件.pdf'])
    expect(nextExportName(existing, name)).toBe(nextAvailableName(existing, name))
  expect(nextExportName(existing, '记录.txt')).toBe('记录 (3).txt')
  expect(existing).toHaveLength(3)
})
