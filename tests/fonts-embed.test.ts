import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const fontRoot = path.join(root, 'src/renderer/src/assets/fonts')

describe('embedded application fonts', () => {
  it('ships every approved font weight in the bundle source', () => {
    for (const file of [
      'SF-Pro-Display-Regular.otf',
      'SF-Pro-Display-Semibold.otf',
      'SF-Pro-Text-Regular.otf',
      'SF-Pro-Text-Medium.otf',
      'SF-Pro-Text-Semibold.otf',
      'PingFangSC-Regular.ttf',
      'PingFangSC-Medium.ttf',
      'PingFangSC-Bold.ttf'
    ]) {
      expect(fs.statSync(path.join(fontRoot, file)).size).toBeGreaterThan(0)
    }
  })

  it('registers the embedded fonts before rendering', () => {
    const source = fs.readFileSync(path.join(root, 'src/renderer/src/main.tsx'), 'utf8')
    expect(source).toContain("fontStyle.dataset.cocFonts = 'embedded'")
    expect(source).toContain('@font-face')
    expect(source).toContain('SF Pro Display')
    expect(source).toContain('SF Pro Text')
    expect(source).toContain('PingFang SC')
  })
})
