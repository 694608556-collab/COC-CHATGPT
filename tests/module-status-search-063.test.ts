import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database'
import { AppRepository } from '../src/main/repository'
import { DEFAULT_FILTER_PRESET, MODULE_PLAY_STATUS_LABELS, type SessionRecord } from '../src/shared/types'
import { recordPlainText, searchModuleRecords } from '../src/shared/record-search'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

function withRepository<T>(action: (repository: AppRepository) => T): T {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-063-'))
  const database = new AppDatabase(path.join(directory, 'coc.sqlite'))
  database.initialize()
  const repository = new AppRepository(database, path.join(directory, 'archive'))
  try {
    return action(repository)
  } finally {
    database.close()
  }
}

describe('0.6.3 module play status', () => {
  const app = read('src/renderer/src/App.tsx')
  const styles = read('src/renderer/src/styles.css')
  const types = read('src/shared/types.ts')
  const ipc = read('src/main/ipc.ts')
  const database = read('src/main/database.ts')

  it('ships the three play statuses with their labels', () => {
    expect(MODULE_PLAY_STATUS_LABELS.finished).toBe('已完成')
    expect(MODULE_PLAY_STATUS_LABELS.running).toBe('进行中')
    expect(MODULE_PLAY_STATUS_LABELS.not_started).toBe('未开始')
    expect(types).toContain("export type ModulePlayStatus = 'finished' | 'running' | 'not_started'")
  })

  it('requires an explicit status on create and stores what was chosen', () => {
    withRepository((repository) => {
      const module = repository.createModule({ name: '暗影循迹', playStatus: 'running' })
      expect(module.playStatus).toBe('running')
      const updated = repository.updateModule(module.id, { playStatus: 'finished' })
      expect(updated.playStatus).toBe('finished')
      // 名称等其它字段不受影响
      expect(updated.name).toBe('暗影循迹')
    })
  })

  it('rejects a missing or unknown status on create', () => {
    withRepository((repository) => {
      expect(() =>
        repository.createModule({ name: '模组', playStatus: undefined as never })
      ).toThrow('请选择跑团状态')
      expect(() =>
        repository.createModule({ name: '模组', playStatus: 'unknown' as never })
      ).toThrow('请选择跑团状态')
    })
  })

  it('migrates older databases to schema v4 and backfills not_started', () => {
    // 只断言 v4 这一步还在；版本号本身会随迁移递增，不写死
    expect(database).toMatch(/const SCHEMA_VERSION = \d+/)
    expect(database).toContain("ALTER TABLE modules ADD COLUMN play_status TEXT NOT NULL DEFAULT 'not_started'")
    expect(database).toContain('if (currentVersion < 4)')
  })

  it('validates the status through the ipc schema', () => {
    expect(ipc).toContain("const modulePlayStatus = z.enum(['finished', 'running', 'not_started'])")
    expect(ipc).toContain('playStatus: modulePlayStatus')
  })

  it('renders the picker next to the module name and forces a choice', () => {
    // 模组名与跑团状态并排
    expect(app).toContain('className="module-head-fields"')
    expect(app).toContain('play-status-picker')
    expect(app).toContain('role="radiogroup"')
    expect(app).toContain('MODULE_PLAY_STATUSES.map')
    // 新建时不预选，保存前必须选一个
    expect(app).toContain("setMessage('请选择跑团状态')")
    // 列表里在“N 场”徽章旁显示状态
    expect(app).toContain('play-status-badge')
  })

  it('keeps the status label styled like the module name label', () => {
    // “跑团状态”和“模组名”共用同一套标签样式
    const labelRule = styles.slice(styles.indexOf('.module-head-fields > label,'), styles.indexOf('.play-status-picker {'))
    expect(labelRule).toContain('font-size: 12px')
    expect(labelRule).toContain('font-weight: 650')
    // 点选控件与输入框同高
    const picker = styles.slice(styles.indexOf('.play-status-picker {'), styles.indexOf('.play-status-option {'))
    expect(picker).toContain('min-height: 34px')
    expect(styles).toContain('.play-status-option.selected')
  })
})

describe('0.6.3 whole-module body search', () => {
  const app = read('src/renderer/src/App.tsx')

  function record(overrides: Partial<SessionRecord>): SessionRecord {
    return {
      id: 'r1',
      moduleId: 'm1',
      name: '第 1 场',
      sequenceNo: 1,
      sourceType: 'online',
      status: 'valid',
      dateSource: 'none',
      order: 0,
      createdAt: '',
      updatedAt: '',
      ...overrides
    }
  }

  it('reads manual content and fetched logs as searchable text', () => {
    expect(recordPlainText(record({ manualContent: '本地正文' }), DEFAULT_FILTER_PRESET)).toBe('本地正文')
    // 没检测过的场次没有正文
    expect(recordPlainText(record({}), DEFAULT_FILTER_PRESET)).toBe('')
  })

  it('finds matches across a module and reports count plus excerpt', () => {
    const records = [
      record({ id: 'r1', name: '第 1 场', manualContent: '走廊尽头传来脚步声，走廊很暗。' }),
      record({ id: 'r2', name: '第 2 场', manualContent: '这次没有那个词。' }),
      record({ id: 'r3', name: '第 3 场', manualContent: '又是走廊。' })
    ]
    const hits = searchModuleRecords(records, '走廊', DEFAULT_FILTER_PRESET)
    expect(hits.map((hit) => hit.recordId)).toEqual(['r1', 'r3'])
    expect(hits[0]!.matches).toBe(2)
    expect(hits[0]!.recordName).toBe('第 1 场')
    // 摘要里带着关键词，且给出高亮区间
    expect(hits[0]!.excerpt).toContain('走廊')
    expect(hits[0]!.excerpt.slice(hits[0]!.excerptStart, hits[0]!.excerptStart + hits[0]!.excerptLength)).toBe(
      '走廊'
    )
  })

  it('ignores an empty query and never throws on blank records', () => {
    expect(searchModuleRecords([record({})], '   ', DEFAULT_FILTER_PRESET)).toEqual([])
    expect(searchModuleRecords([], '走廊', DEFAULT_FILTER_PRESET)).toEqual([])
  })

  it('wires the search box into the participants row with the requested placeholder', () => {
    expect(app).toContain('placeholder="全模组正文搜索"')
    expect(app).toContain('className="module-search"')
    // 搜索结果可点击，点开该场次详情
    expect(app).toContain('module-search-hit')
    expect(app).toContain('setDetailRecordId(hit.recordId)')
  })
})

describe('0.6.3 note board fixes', () => {
  const board = read('src/renderer/src/components/NoteBoard.tsx')
  const styles = read('src/renderer/src/styles.css')

  it('does not render the edited note a second time next to the editor', () => {
    // 0.6.3 之前 notes.map 会把正在编辑的那条再画一遍，看着像“修改前版本”
    expect(board).toContain('note.id !== draft?.id')
  })

  it('doubles the note card height and widens the text clamp to match', () => {
    const card = styles.slice(styles.indexOf('/* ============ 0.6.3 闲记卡片加高 ============ */'))
    expect(card).toContain('min-height: 400px')
    // 高度加了但行数不放宽的话，正文依旧被截断
    expect(card).toContain('-webkit-line-clamp: 10')
  })
})
