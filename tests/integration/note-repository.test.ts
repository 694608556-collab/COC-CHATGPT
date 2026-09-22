import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { AppRepository } from '../../src/main/repository'

let database: AppDatabase
let repository: AppRepository
let directory: string

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-note-'))
  database = new AppDatabase(path.join(directory, 'coc.sqlite'))
  database.initialize()
  repository = new AppRepository(database, path.join(directory, 'archive'))
})

afterEach(() => database.close())

describe('note persistence', () => {
  it('creates, lists, edits and deletes notes', () => {
    const module = repository.createModule({ name: '长夜', playStatus: 'not_started' })
    const note = repository.createNote({ moduleName: module.name, content: '第一行\n第二行' })
    expect(note.content).toBe('第一行\n第二行')
    expect(note.noteDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(repository.listNotes()).toHaveLength(1)

    const updated = repository.updateNote(note.id, { noteDate: '2026-01-02', moduleName: '' })
    expect(updated.noteDate).toBe('2026-01-02')
    expect(updated.moduleName).toBe('')
    expect(updated.createdAt).toBe(note.createdAt)

    repository.deleteNote(note.id)
    expect(repository.listNotes()).toEqual([])
  })

  it('keeps notes in the snapshot and orders the newest first', () => {
    const first = repository.createNote({ content: '先写的' })
    const second = repository.createNote({ content: '后写的' })
    const snapshot = repository.snapshot()
    expect(snapshot.schemaVersion).toBe(2)
    expect(snapshot.notes.map((note) => note.id)).toEqual([second.id, first.id])
  })

  it('keeps image paths on the note record', () => {
    const note = repository.createNote({ images: [{ path: 'notes/a.png', name: 'a.png' }] })
    expect(repository.findNote(note.id).images).toEqual([{ path: 'notes/a.png', name: 'a.png' }])
  })
})

describe('backup compatibility', () => {
  it('restores a v1 snapshot that has no notes', () => {
    const legacy = {
      ...repository.snapshot(),
      schemaVersion: 1 as const,
      notes: undefined
    } as unknown as ReturnType<AppRepository['snapshot']>
    repository.createNote({ content: '会被清掉' })
    repository.replaceFromBackup(legacy, { restoreSettings: false, archiveDirectory: path.join(directory, 'archive') })
    expect(repository.listNotes()).toEqual([])
  })

  it('round trips notes through a v2 snapshot restore', () => {
    const note = repository.createNote({ content: '保留我' })
    const snapshot = repository.snapshot()
    repository.deleteNote(note.id)
    expect(repository.listNotes()).toEqual([])
    repository.replaceFromBackup(snapshot, { restoreSettings: false, archiveDirectory: path.join(directory, 'archive') })
    expect(repository.listNotes().map((item) => item.content)).toEqual(['保留我'])
  })
})
