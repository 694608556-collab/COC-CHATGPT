import { describe, expect, it } from 'vitest'
import { isPathInside, nextAvailableName, sanitizeWindowsName } from '../src/shared/safe-path'

describe('safe Windows paths', () => {
  it('sanitizes illegal and reserved names without changing app data', () => {
    expect(sanitizeWindowsName('暗影:循迹? ')).toBe('暗影＿循迹＿')
    expect(sanitizeWindowsName('CON')).toBe('_CON')
    expect(sanitizeWindowsName('...')).toBe('未命名')
  })

  it('rejects path traversal and sibling prefixes', () => {
    expect(isPathInside('C:\\archive\\module', 'C:\\archive\\module\\a.pdf')).toBe(true)
    expect(isPathInside('C:\\archive\\module', 'C:\\archive\\module-other\\a.pdf')).toBe(false)
    expect(isPathInside('C:\\archive\\module', 'C:\\archive\\outside.pdf')).toBe(false)
  })

  it('adds a non-overwriting sequence before the extension', () => {
    expect(nextAvailableName(['记录.pdf', '记录 (2).pdf'], '记录.pdf')).toBe('记录 (3).pdf')
  })
})
