import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDataDirectory, resolvePortableRoot } from '../src/shared/portable-path'

describe('portable data directory', () => {
  it('uses the portable executable directory instead of an extraction directory', () => {
    const root = resolvePortableRoot({
      portableExecutableDir: 'D:\\COC 跑团记录簿',
      executablePath: 'C:\\Temp\\portable-extract\\app.exe'
    })
    expect(root).toBe(path.resolve('D:\\COC 跑团记录簿'))
    expect(
      resolveDataDirectory({
        portableExecutableDir: 'D:\\COC 跑团记录簿',
        executablePath: 'C:\\Temp\\portable-extract\\app.exe'
      })
    ).toBe(path.join(path.resolve('D:\\COC 跑团记录簿'), 'data'))
  })

  it('uses the development root during local development', () => {
    expect(
      resolvePortableRoot({
        executablePath: 'C:\\Electron\\electron.exe',
        developmentRoot: 'C:\\workspace\\coc-app'
      })
    ).toBe(path.resolve('C:\\workspace\\coc-app'))
  })

  it('falls back to the executable directory', () => {
    expect(
      resolvePortableRoot({
        executablePath: 'E:\\Apps\\COC\\COC.exe'
      })
    ).toBe(path.resolve('E:\\Apps\\COC'))
  })

  it('keeps data beside the executable after the portable folder is moved', () => {
    const before = resolveDataDirectory({
      portableExecutableDir: 'D:\\Games\\COC App',
      executablePath: 'C:\\Temp\\extract-a\\app.exe'
    })
    const after = resolveDataDirectory({
      portableExecutableDir: 'E:\\Backups\\COC App',
      executablePath: 'C:\\Temp\\extract-b\\app.exe'
    })
    expect(before).toBe(path.resolve('D:\\Games\\COC App', 'data'))
    expect(after).toBe(path.resolve('E:\\Backups\\COC App', 'data'))
    expect(after).not.toContain('extract-b')
  })
})
