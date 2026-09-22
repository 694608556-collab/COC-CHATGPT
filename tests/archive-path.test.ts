import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArchivePathService, ensureWritableDirectory, inspectArchiveDirectory } from '../src/main/archive-path'
import { AppError } from '../src/shared/errors'

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

// 0.6.3：换过 Windows 账户后，设置里可能残留别的用户目录
// （例如当前用户是 Admin，路径却写着 C:\Users\Administrator）。
// 此时下载/合成/导出全部失败，但界面原本只显示“文件生成失败”，看不出原因。
describe('archive directory diagnostics', () => {
  it('reports a usable directory as ok', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-arch-ok-'))
    roots.push(root)
    expect(inspectArchiveDirectory(root)).toEqual({ ok: true })
    expect(() => ensureWritableDirectory(root)).not.toThrow()
  })

  it('surfaces an unwritable directory as an AppError with the real path', () => {
    // 指向一个不可能创建的位置：把文件当目录用
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-arch-bad-'))
    roots.push(root)
    const blocker = path.join(root, 'blocker')
    fs.writeFileSync(blocker, 'not a directory')
    const target = path.join(blocker, 'child')

    let caught: unknown
    try {
      ensureWritableDirectory(target)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AppError)
    const appError = caught as AppError
    expect(appError.code).toBe('ARCHIVE_DIRECTORY_UNAVAILABLE')
    // 关键：错误信息里必须带上真实路径，否则用户无从下手
    expect(appError.message).toContain(target)
    expect(appError.message).toContain('数据与设置')
  })

  it('tells inspectArchiveDirectory the same story without throwing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-arch-bad2-'))
    roots.push(root)
    const blocker = path.join(root, 'blocker')
    fs.writeFileSync(blocker, 'not a directory')
    const status = inspectArchiveDirectory(path.join(blocker, 'child'))
    expect(status.ok).toBe(false)
    expect(status.reason).toBeTruthy()
  })

  it('fails the export path early instead of producing a bare EPERM', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-arch-bad3-'))
    roots.push(root)
    const blocker = path.join(root, 'blocker')
    fs.writeFileSync(blocker, 'not a directory')
    const service = new ArchivePathService(() => path.join(blocker, 'child'))
    expect(() => service.availableFile('\u957f\u56e2', 'x.txt')).toThrow(AppError)
  })
})
