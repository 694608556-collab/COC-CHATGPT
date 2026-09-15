import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { AppDatabase, CURRENT_SCHEMA_VERSION, cleanLinkedPairs } from '../src/main/database'

describe('module roster cleanup', () => {
  it('drops untouched rows and unlinks the rows the user kept', () => {
    const result = cleanLinkedPairs(
      [
        { pc: '温煦', pl: '', characterId: 'c1' },
        { pc: '陆桉阳', pl: '烟蓑雨涨', characterId: 'c2' },
        { pc: '温煦·改', pl: '', characterId: 'c1' },
        { pc: '路人', pl: '' }
      ],
      (id) => (id === 'c1' ? '温煦' : id === 'c2' ? '陆桉阳' : undefined)
    )
    expect(result).toEqual([
      { pc: '陆桉阳', pl: '烟蓑雨涨' },
      { pc: '温煦·改', pl: '' },
      { pc: '路人', pl: '' }
    ])
  })

  it('cleans an older database while upgrading it', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-migrate-'))
    const file = path.join(directory, 'coc.sqlite')
    const initial = new AppDatabase(file)
    initial.initialize()
    initial.close()

    // rebuild the state a 0.5.7 database would have had
    const raw = new DatabaseSync(file)
    const stamp = '2026-01-01T00:00:00.000Z'
    const pairs = JSON.stringify([
      { pc: '温煦', pl: '', characterId: 'c1' },
      { pc: '陆桉阳', pl: '烟蓑雨涨', characterId: 'c2' }
    ])
    raw
      .prepare('INSERT INTO modules (id,name,kps_json,pairs_json,sort_order,collapsed,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('m1', '铸形骸', '[]', pairs, 0, 0, stamp, stamp)
    const insertCharacter = raw.prepare('INSERT INTO characters (id,module_id,edition,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    insertCharacter.run('c1', 'm1', 7, JSON.stringify({ basic: { name: '温煦' } }), stamp, stamp)
    insertCharacter.run('c2', 'm1', 7, JSON.stringify({ basic: { name: '陆桉阳' } }), stamp, stamp)
    raw.prepare('UPDATE schema_meta SET version = 2').run()
    raw.close()

    const upgraded = new AppDatabase(file)
    upgraded.initialize()
    const rows = upgraded.connection.prepare('SELECT pairs_json FROM modules').all() as Array<
      Record<string, unknown>
    >
    upgraded.close()

    expect(JSON.parse(String(rows[0]?.pairs_json))).toEqual([
      { pc: '陆桉阳', pl: '烟蓑雨涨' }
    ])
    expect(CURRENT_SCHEMA_VERSION).toBe(3)
  })
})
