/**
 * 0.6.6 回归：导入表格把场次名重排成连续编号后，新增场次不得再弹出
 * “选择下一场编号”。
 *
 * 这里直接在库里造出用户遇到的状态：场次名是 1-4，编号却是 1、2、3、17。
 * 修复前界面按编号判断连续性，会认定缺 4-16 并弹出选择窗口；修复后升级迁移
 * 会把编号校正回 1-4，点“添加场次”直接打开编辑器。
 */
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const executablePath = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')

function cleanEnvironment(dataDirectory: string): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toLowerCase() !== 'path' && value !== undefined) environment[key] = value
  }
  environment.PATH = process.env.PATH || process.env.Path || ''
  environment.PORTABLE_EXECUTABLE_DIR = dataDirectory
  return environment
}

async function launch(dataDirectory: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath,
    args: ['.', `--user-data-dir=${dataDirectory}`],
    cwd: projectRoot,
    env: cleanEnvironment(dataDirectory)
  })
}

/** 造一个 0.6.5 会留下的库：名称连续、编号有空洞 */
function seedBrokenDatabase(file: string): void {
  // IPC 校验要求模组 id 是 uuid，这里必须用真 uuid，否则保存会被 schema 挡下
  const moduleId = '5b1f6d2c-9a44-4f0e-8f6b-2c7d1e3a4b50'
  const raw = new DatabaseSync(file)
  const stamp = '2026-01-01T00:00:00.000Z'
  raw.exec(`
    CREATE TABLE schema_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, migrated_at TEXT NOT NULL);
    CREATE TABLE modules (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kps_json TEXT NOT NULL DEFAULT '[]',
      pairs_json TEXT NOT NULL DEFAULT '[]', sort_order INTEGER NOT NULL,
      collapsed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      play_status TEXT NOT NULL DEFAULT 'not_started'
    );
    CREATE TABLE module_sequences (module_id TEXT PRIMARY KEY, maximum INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE records (
      id TEXT PRIMARY KEY, module_id TEXT NOT NULL, name TEXT NOT NULL, sequence_no INTEGER NOT NULL,
      link TEXT, source_type TEXT NOT NULL, status TEXT NOT NULL, previous_status TEXT,
      play_date TEXT, date_source TEXT NOT NULL, fetched_at TEXT, raw_json TEXT, manual_content TEXT,
      cache_source_url TEXT, last_error TEXT, sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE characters (id TEXT PRIMARY KEY, module_id TEXT, edition INTEGER NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), data_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE import_mappings (id TEXT PRIMARY KEY, data_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE archive_entries (id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, path TEXT NOT NULL, format TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, hash TEXT, exists_flag INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE notes (id TEXT PRIMARY KEY, module_name TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', images_json TEXT NOT NULL DEFAULT '[]', note_date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `)
  raw.prepare('INSERT INTO schema_meta (id, version, migrated_at) VALUES (1, 4, ?)').run(stamp)
  raw
    .prepare(
      'INSERT INTO modules (id,name,kps_json,pairs_json,sort_order,collapsed,created_at,updated_at,play_status) VALUES (?,?,?,?,?,?,?,?,?)'
    )
    .run(moduleId, '铸形骸', '[]', '[]', 0, 0, stamp, stamp, 'not_started')
  raw.prepare('INSERT INTO module_sequences (module_id, maximum) VALUES (?, ?)').run(moduleId, 17)
  const insert = raw.prepare(
    'INSERT INTO records (id,module_id,name,sequence_no,link,source_type,status,date_source,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  )
  // 名称 1-4 连续，编号却是 1、2、3、17——正是导入表格重排场次名后的样子
  const seeded: Array<{ id: string; sequenceNo: number }> = [
    { id: 'a1b2c3d4-0001-4000-8000-000000000001', sequenceNo: 1 },
    { id: 'a1b2c3d4-0002-4000-8000-000000000002', sequenceNo: 2 },
    { id: 'a1b2c3d4-0003-4000-8000-000000000003', sequenceNo: 3 },
    { id: 'a1b2c3d4-0004-4000-8000-000000000004', sequenceNo: 17 }
  ]
  seeded.forEach(({ id, sequenceNo }, index) => {
    insert.run(id, moduleId, `铸形骸第 ${index + 1} 场`, sequenceNo, null, 'online', 'pending', 'none', index, stamp, stamp)
  })
  raw.close()
}

test('0.6.6 no longer asks for a session number after an import renumbered the names', async () => {
  const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-066-中文-'))
  const dataDirectory = path.join(portableRoot, 'data')
  fs.mkdirSync(dataDirectory, { recursive: true })
  const databaseFile = path.join(dataDirectory, 'coc.sqlite')
  seedBrokenDatabase(databaseFile)

  const application = await launch(portableRoot)
  try {
    const page = await application.firstWindow()
    await expect(page.getByText('COC 跑团记录簿').first()).toBeVisible()

    // 升级到 schema v5 时应留下升级前备份
    expect(fs.existsSync(`${databaseFile}.before-v5.bak`)).toBe(true)

    // 编号应已按名称校正为 1-4，不再有 4-16 的假空缺
    const db = new DatabaseSync(databaseFile, { readOnly: true })
    const rows = db
      .prepare('SELECT name, sequence_no FROM records ORDER BY sequence_no')
      .all() as Array<{ name: string; sequence_no: number }>
    db.close()
    expect(rows.map((row) => row.sequence_no)).toEqual([1, 2, 3, 4])
    for (const row of rows) {
      expect(row.sequence_no).toBe(Number((row.name.match(/第\s*(\d+)\s*场/) || [])[1]))
    }

    // 界面按顺序列出 1-4
    await expect(page.locator('.module-card').first().locator('.count-badge')).toHaveText('4 场')
    await expect(page.locator('.record-name').nth(3)).toHaveText('铸形骸第 4 场')

    // 关键回归：点“添加场次”不得弹出编号选择窗口
    await page.locator('.module-card').first().getByRole('button', { name: '+ 添加场次' }).click()
    await expect(page.getByText('选择下一场编号')).toHaveCount(0)
    await expect(page.locator('.sequence-picker')).toHaveCount(0)
    const dialog = page.getByRole('dialog', { name: '新增场次' })
    await expect(dialog).toBeVisible()

    // 保存后应接续为第 5 场
    await dialog.getByRole('button', { name: '保存场次' }).click()
    await expect(page.getByRole('button', { name: '铸形骸第 5 场', exact: true })).toBeVisible()
  } finally {
    await application.close()
  }
})
