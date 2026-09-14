import { describe, expect, it } from 'vitest'
import {
  TABLE_IMPORT_HEADERS,
  buildTableImportTemplate,
  mergeImportedParticipants,
  normalizeTableImportRows,
  parseImportedParticipants,
  validateTableImportRow
} from '../src/shared/table-import'

describe('table import', () => {
  it('maps the confirmed four-column template', () => {
    const rows = normalizeTableImportRows([
      {
        '\u6a21\u7ec4\u540d\u79f0': '\u6697\u5f71\u5faa\u8ff9',
        '\u573a\u6b21': '\u7b2c\u4e00\u573a',
        '\u6d77\u8c79\u94fe\u63a5': 'https://log.weizaima.com/?key=one',
        '\u53c2\u4e0e\u8005': 'KP \u963f\u9ed8'
      }
    ])
    expect(rows[0]).toEqual({
      moduleName: '\u6697\u5f71\u5faa\u8ff9',
      sessionName: '\u7b2c\u4e00\u573a',
      link: 'https://log.weizaima.com/?key=one',
      participants: 'KP \u963f\u9ed8'
    })
    expect(validateTableImportRow(rows[0]!)).toBeUndefined()
  })

  it('reports invalid rows without throwing', () => {
    const [row] = normalizeTableImportRows([
      {
        '\u6a21\u7ec4\u540d\u79f0': '',
        '\u573a\u6b21': '',
        '\u6d77\u8c79\u94fe\u63a5': 'not-a-url'
      }
    ])
    expect(validateTableImportRow(row!)).toContain('\u6a21\u7ec4')
  })

  it('parses KP and paired PC/PL values', () => {
    const value = [
      'KP \u963f\u9ed8',
      'PC \u827e\u4f26/PL \u674e\u56db',
      '\u590f\u6069/\u738b\u4e94',
      'PC \u5b64\u661f'
    ].join('\uff1b')
    expect(parseImportedParticipants(value)).toEqual({
      kps: ['\u963f\u9ed8'],
      pairs: [
        { pc: '\u827e\u4f26', pl: '\u674e\u56db' },
        { pc: '\u590f\u6069', pl: '\u738b\u4e94' },
        { pc: '\u5b64\u661f', pl: '' }
      ]
    })
  })

  it('merges participant names without duplicates', () => {
    const merged = mergeImportedParticipants(
      {
        kps: ['\u963f\u9ed8'],
        pairs: [{ pc: '\u827e\u4f26', pl: '\u674e\u56db' }]
      },
      {
        kps: ['\u963f\u9ed8', '\u5f20\u4e09'],
        pairs: [{ pc: '\u827e\u4f26', pl: '\u674e\u56db' }]
      }
    )
    expect(merged.kps).toEqual(['\u963f\u9ed8', '\u5f20\u4e09'])
    expect(merged.pairs).toHaveLength(1)
  })

  it('exports the exact template header', () => {
    expect(buildTableImportTemplate()).toBe('\ufeff' + TABLE_IMPORT_HEADERS.join(',') + '\r\n')
  })
})
