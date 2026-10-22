import { expect, it } from 'vitest'
import { backupExportName, nextExportName } from '../../../src/shared/export-filenames'

it('整库备份使用本地日期与应用名，JSON、ZIP及自动备份共用当天后续序号', () => {
  const date = new Date(2026, 9, 22, 0, 30)
  expect(backupExportName('json', date)).toBe('20261022COC跑团记录簿.json')
  const existing = ['20261022COC跑团记录簿.json']
  expect(nextExportName(existing, backupExportName('zip', date))).toBe('20261022COC跑团记录簿1.zip')
  existing.push('20261022COC跑团记录簿1.zip')
  expect(nextExportName(existing, backupExportName('json', date))).toBe('20261022COC跑团记录簿2.json')
  expect(nextExportName(existing, backupExportName('json', new Date(2026, 9, 23)))).toBe(
    '20261023COC跑团记录簿.json'
  )
  expect(existing).toEqual(['20261022COC跑团记录簿.json', '20261022COC跑团记录簿1.zip'])
})

it('保留已有文件与普通导出重名规则，缺少首份时也续接当天最大备份序号', () => {
  expect(nextExportName(['20261022COC跑团记录簿4.zip'], '20261022COC跑团记录簿.json')).toBe(
    '20261022COC跑团记录簿5.json'
  )
  expect(nextExportName(['public.txt'], 'public.txt')).toBe('public (2).txt')
})
