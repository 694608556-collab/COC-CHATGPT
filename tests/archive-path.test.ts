import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArchivePathService } from '../src/main/archive-path'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('archive paths', () => {
  it('keeps single downloads in the module folder', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-path-'))
    roots.push(root)
    const service = new ArchivePathService(() => root)
    const file = service.availableFile('\u957f\u56e2', '20260907\u957f\u56e2\u7b2c\u4e00\u573a.txt')
    expect(file).toBe(path.join(root, '\u957f\u56e2', '20260907\u957f\u56e2\u7b2c\u4e00\u573a.txt'))
  })

  it('puts combined files in the batch folder by module', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-path-'))
    roots.push(root)
    const service = new ArchivePathService(() => root)
    const file = service.batchFile('\u957f\u56e2', '20260907\u957f\u56e2\u5408\u96c6.txt')
    expect(file).toBe(
      path.join(root, '\u6279\u91cf\u5408\u6210', '\u957f\u56e2', '20260907\u957f\u56e2\u5408\u96c6.txt')
    )
  })
})
