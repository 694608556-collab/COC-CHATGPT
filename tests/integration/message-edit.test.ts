import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { AppRepository } from '../../src/main/repository'
import type { SessionRecord } from '../../src/shared/types'

let database: AppDatabase
let repository: AppRepository
let record: SessionRecord
beforeEach(() => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-message-edit-'))
  database = new AppDatabase(path.join(directory, 'coc.sqlite'))
  database.initialize()
  repository = new AppRepository(database, path.join(directory, 'archive'))
  const module = repository.createModule({ name: '公开消息编辑', playStatus: 'running' })
  const created = repository.createRecord({ moduleId: module.id, link: 'https://log.weizaima.com/?key=public-message-edit' })
  record = repository.updateRecord(created.id, {
    status: 'valid',
    rawContent: { parserVersion: 1, sourceUrl: created.link, messages: Array.from({ length: 240 }, (_, index) => ({
      id: 'message-' + index, order: index, displayName: '原说话者', text: '原正文' + index,
      timestamp: '2026-11-17T00:00:00Z', type: 'text', platformAccount: '123',
      isDiceCommand: false, isOffTopic: false, images: [{ url: 'https://example.invalid/image.png' }],
      raw: { original: '保留原始来源' }
    })) }
  })
})
afterEach(() => database.close())

describe('transactional message editing', () => {
  it('saves speaker and full body with all other messages and fields intact', () => {
    const body = '完整内容'.repeat(100000) + '\n末行'
    const saved = repository.editMessage(record.id, 'message-104', body, '新说话者', record.updatedAt)
    expect(saved.rawContent!.messages[104]).toEqual({ ...record.rawContent!.messages[104], displayName: '新说话者', text: body })
    expect(saved.rawContent!.messages.filter((_, i) => i !== 104)).toEqual(record.rawContent!.messages.filter((_, i) => i !== 104))
    expect({ ...saved, rawContent: record.rawContent, updatedAt: record.updatedAt }).toEqual(record)
    expect(repository.snapshot().records.find((row) => row.id === record.id)).toEqual(saved)
  })
  it('rejects stale drafts including two edits within one clock tick', () => {
    const saved = repository.editMessage(record.id, 'message-0', '第一次', '甲', record.updatedAt)
    expect(saved.updatedAt).not.toBe(record.updatedAt)
    expect(() => repository.editMessage(record.id, 'message-1', '过期覆盖', '乙', record.updatedAt)).toThrow('数据已变化')
    expect(repository.snapshot().records.find((row) => row.id === record.id)).toEqual(saved)
  })
  it('rolls back failed writes and rejects missing IDs', () => {
    expect(() => repository.editMessage(record.id, 'missing', '修改', '甲', record.updatedAt)).toThrow('正文已变化')
    database.connection.exec("CREATE TRIGGER reject_edit BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT, '公开写入失败'); END")
    expect(() => repository.editMessage(record.id, 'message-0', '修改', '甲', record.updatedAt)).toThrow('公开写入失败')
    expect(repository.snapshot().records.find((row) => row.id === record.id)).toEqual(record)
  })
  it('retains whitespace, blank lines and manual speaker on subsequent edits', () => {
    const moduleId = record.moduleId
    const manual = repository.createRecord({ moduleId, manualContent: '首行\r\n\r\n第三行\n尾行' })
    const saved = repository.editMessage(manual.id, 'manual-2', ' 新正文\n第二段 ', '手动角色', manual.updatedAt)
    expect(saved.manualContent).toBe('首行\r\n\r\n手动角色： 新正文\n第二段 \n尾行')
    const next = repository.editMessage(saved.id, 'manual-2', '', '', saved.updatedAt)
    expect(next.manualContent).toBe('首行\r\n\r\n\n尾行')
  })
})
