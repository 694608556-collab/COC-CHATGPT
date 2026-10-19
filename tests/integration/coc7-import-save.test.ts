import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { AppRepository } from '../../src/main/repository'
import { previewCoc7Import } from '../../src/shared/coc7-import'
import { publicCoc7Bytes } from '../fixtures/coc7'

describe('七版草稿持久化', () => {
  it('只读预览、同名新增、失败不留空卡并保留源表当前数值', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-088-save-'))
    let db = new AppDatabase(path.join(directory, 'coc.sqlite'))
    db.initialize()
    let repository = new AppRepository(db, path.join(directory, 'archive'))
    try {
      const draft = previewCoc7Import(publicCoc7Bytes(), 'public.xlsx').character
      expect(repository.snapshot().characters).toHaveLength(0)
      const first = repository.saveImportedCharacter(draft)
      const second = repository.saveImportedCharacter(draft)
      expect(first.id).not.toBe(second.id)
      expect(second.basic).toEqual(draft.basic)
      expect(second.derived).toEqual(draft.derived)
      expect(second.skills).toEqual(draft.skills)
      expect(second.background).toEqual(draft.background)
      expect(() =>
        repository.saveImportedCharacter({ ...draft, moduleIds: ['nonexistent-module'] })
      ).toThrow()
      expect(repository.snapshot().characters).toHaveLength(2)
      db.close()
      db = new AppDatabase(path.join(directory, 'coc.sqlite'))
      db.initialize()
      repository = new AppRepository(db, path.join(directory, 'archive'))
      expect(repository.snapshot().characters).toHaveLength(2)
      expect(repository.findCharacter(first.id).derived).toEqual(draft.derived)
    } finally {
      db.close()
    }
  })
})
