import * as XLSX from 'xlsx'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { searchSample } from '../src/dev/sample'
import { previewBackup } from '../src/data/backup'
import { publicCoc7Workbook } from '../test-fixtures/coc7'

const output = process.argv[2]!
const snapshot = (await previewBackup(new TextEncoder().encode(JSON.stringify(searchSample())))).snapshot
const template = snapshot.records[0]!
snapshot.modules = [{ ...snapshot.modules[0]!, name: '公开计时模组' }]
snapshot.characters = []
snapshot.records = Array.from({ length: 78 }, (_, record) => ({
  ...template,
  id: `public-io-${record}`,
  name: `公开计时场次${record}`,
  order: record,
  sequenceNo: record + 1,
  rawContent: {
    ...template.rawContent!,
    messages: Array.from({ length: 650 }, (_, message) => ({
      ...template.rawContent!.messages[0]!,
      id: `public-message-${message}`,
      order: message,
      text: 'PUBLIC_IO_NEEDLE ' + '公开完整正文'.repeat(12) + ` PUBLIC_END_${record}_${message}`
    }))
  }
}))
writeFileSync(join(output, 'public-io-library.json'), JSON.stringify(snapshot))
const table = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(
  table,
  XLSX.utils.aoa_to_sheet([
    ['模组名', '场次名', '海豹链接', '手动保存内容'],
    ...Array.from({ length: 114 }, (_, i) => [
      '公开导入模组',
      `公开导入场${i}`,
      `https://log.weizaima.com/?key=public-io-${i}`,
      ''
    ]),
    ['公开导入模组', '公开导入完整手动正文', '', 'PUBLIC_MANUAL_BEGIN\n完整😀正文\nPUBLIC_MANUAL_END']
  ]),
  '场次'
)
const card = publicCoc7Workbook()
XLSX.utils.book_append_sheet(
  card,
  XLSX.utils.aoa_to_sheet(
    Array.from({ length: 65 }, (_, i) => [`public-auxiliary-${i}-`.padEnd(10000, 'x')])
  ),
  '公开辅助说明'
)
// BIFF8's writer cannot split a single 10KB SST item reliably. Retain the same
// 650,000 auxiliary characters in more cells; keep the larger XLS input in coverage.
const biffCard = publicCoc7Workbook()
XLSX.utils.book_append_sheet(
  biffCard,
  XLSX.utils.aoa_to_sheet(
    Array.from({ length: 1300 }, (_, i) => [`public-auxiliary-${i}-`.padEnd(500, 'x')])
  ),
  '公开辅助说明'
)
for (const [name, book] of [
  ['public-io-table', table],
  ['public-io-card', card]
] as const) {
  for (const type of ['xlsx', 'xls'] as const) {
    const value = type === 'xls' && name === 'public-io-card' ? biffCard : book
    const bytes = XLSX.write(value, {
      type: 'buffer',
      bookType: type === 'xls' ? 'biff8' : 'xlsx',
      bookSST: true
    })
    if (name === 'public-io-card') {
      const checked = XLSX.read(bytes, { type: 'buffer' })
      if (checked.Sheets['人物卡']?.E3?.v !== '公开七版调查员')
        throw Error('Public card generation lost primary sheet')
      const auxiliary = XLSX.utils.sheet_to_json<string[]>(checked.Sheets['公开辅助说明']!, { header: 1 })
      if (auxiliary.reduce((count, row) => count + String(row[0] ?? '').length, 0) !== 650000)
        throw Error('Public card auxiliary text changed')
    }
    writeFileSync(join(output, `${name}.${type}`), bytes)
  }
}
writeFileSync(join(output, 'public-io-table.csv'), XLSX.utils.sheet_to_csv(table.Sheets['场次']!))
