import { readWorkbookGrid } from '../../../src/shared/table-grid'
import { detectCharacterSheets, importCharacterFromSheet } from '../../../src/shared/character-template'
import { parseImportSheet, mergeImportedParticipants } from '../../../src/shared/table-import'
import type { MobileSnapshot } from './types'
import { previewBackup } from './backup'
import { parseSeaLogUrl } from './sea-parser'

export interface TablePreview {
  next: MobileSnapshot
  names: string[]
  warnings: string[]
}
export async function importTable(
  current: MobileSnapshot,
  bytes: Uint8Array,
  name: string,
  kind: 'records' | 'characters'
): Promise<TablePreview> {
  const workbook = readWorkbookGrid(bytes, name)
  const next: MobileSnapshot = JSON.parse(JSON.stringify(current))
  const names: string[] = []
  const warnings: string[] = workbook.sheets.flatMap((s) => (s.skippedReason ? [s.skippedReason] : []))
  if (kind === 'characters') {
    for (const found of detectCharacterSheets(workbook)) {
      if (!Object.keys(found.mapping).length) {
        warnings.push(found.sheetName + '：没有识别到角色字段，已跳过。')
        continue
      }
      const sheet = workbook.sheets.find((s) => s.name === found.sheetName)!
      const card = importCharacterFromSheet(
        sheet,
        found.edition,
        found.mapping,
        undefined,
        found.skillHeaderRow
      )
      if (!card.basic.name) card.basic.name = found.sheetName
      next.characters.push(card)
      names.push(card.basic.name)
      warnings.push(...found.warnings.map((w) => found.sheetName + '：' + w))
    }
  } else {
    for (const row of workbook.sheets.flatMap((sheet) => parseImportSheet(sheet.name, sheet.rows))) {
      if (!row.moduleName) throw new Error(row.sheet + ' 缺少模组名，请补齐后重新导入。')
      if (row.link) parseSeaLogUrl(row.link)
      let module = next.modules.find((m) => m.name === row.moduleName)
      const date = new Date().toISOString()
      if (!module) {
        module = {
          id: crypto.randomUUID(),
          name: row.moduleName,
          playStatus: row.playStatus ?? 'not_started',
          kps: row.kps,
          pairs: row.pairs,
          order: next.modules.length,
          collapsed: false,
          createdAt: date,
          updatedAt: date
        }
        next.modules.push(module)
      } else Object.assign(module, mergeImportedParticipants(module, { kps: row.kps, pairs: row.pairs }))
      if (row.link && next.records.some((r) => r.moduleId === module!.id && r.link === row.link)) {
        warnings.push(row.sessionName + '：来源已存在，已跳过。')
        continue
      }
      const count = next.records.filter((r) => r.moduleId === module!.id).length
      const record = {
        id: crypto.randomUUID(),
        moduleId: module.id,
        name: row.sessionName || '第' + (count + 1) + '场',
        sequenceNo: count + 1,
        link: row.link || undefined,
        sourceType: row.link ? ('online' as const) : ('manual' as const),
        status: row.link ? ('pending' as const) : ('manual' as const),
        dateSource: row.playDate ? ('manual' as const) : ('none' as const),
        playDate: row.playDate || undefined,
        manualContent: row.link ? undefined : '',
        order: count,
        createdAt: date,
        updatedAt: date
      }
      next.records.push(record)
      names.push(module.name + ' / ' + record.name)
    }
  }
  if (!names.length) throw new Error('没有可新增的有效数据。')
  next.exportedAt = new Date().toISOString()
  return {
    next: (await previewBackup(new TextEncoder().encode(JSON.stringify(next)))).snapshot,
    names,
    warnings
  }
}
