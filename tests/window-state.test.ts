import { describe, expect, it } from 'vitest'
import { resolveWindowBounds } from '../src/shared/window-state'

describe('desktop window state', () => {
  it('uses 1920×1080 when the work area allows it', () => {
    expect(resolveWindowBounds(undefined, [{ x: 0, y: 0, width: 2560, height: 1400 }])).toEqual({
      width: 1920,
      height: 1080,
      maximized: false
    })
  })

  it('clamps the default size to a smaller work area', () => {
    expect(resolveWindowBounds(undefined, [{ x: 0, y: 0, width: 1366, height: 768 }])).toMatchObject({
      width: 1366,
      height: 768
    })
  })

  it('keeps a visible saved position and rejects a disconnected display', () => {
    const area = [{ x: 0, y: 0, width: 1920, height: 1040 }]
    expect(resolveWindowBounds({ x: 100, y: 100, width: 1200, height: 800, maximized: true }, area)).toEqual({
      x: 100,
      y: 100,
      width: 1200,
      height: 800,
      maximized: true
    })
    expect(
      resolveWindowBounds({ x: 4000, y: 100, width: 1200, height: 800, maximized: false }, area)
    ).toEqual({ width: 1200, height: 800, maximized: false })
  })
})
