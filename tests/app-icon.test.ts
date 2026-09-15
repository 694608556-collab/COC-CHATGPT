import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')

interface IcoEntry {
  width: number
  height: number
}

function readIcoEntries(buffer: Buffer): IcoEntry[] {
  const type = buffer.readUInt16LE(2)
  const count = buffer.readUInt16LE(4)
  if (buffer.readUInt16LE(0) !== 0 || type !== 1) throw new Error('not an ico file')
  const entries: IcoEntry[] = []
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16
    const width = buffer.readUInt8(offset)
    const height = buffer.readUInt8(offset + 1)
    entries.push({ width: width === 0 ? 256 : width, height: height === 0 ? 256 : height })
  }
  return entries
}

describe('application icon', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

  it('points the windows build at the committed icon', () => {
    expect(pkg.build.win.icon).toBe('build/icon.ico')
    expect(fs.existsSync(path.join(root, 'build', 'icon.ico'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'build', 'icon.png'))).toBe(true)
  })

  it('ships every size windows asks for, including 256px', () => {
    const entries = readIcoEntries(fs.readFileSync(path.join(root, 'build', 'icon.ico')))
    const sizes = entries.map((entry) => entry.width).sort((a, b) => a - b)
    expect(sizes).toEqual([16, 24, 32, 48, 64, 128, 256])
    for (const entry of entries) expect(entry.width).toBe(entry.height)
  })

  it('keeps a square transparent source image', () => {
    const png = fs.readFileSync(path.join(root, 'build', 'icon.png'))
    expect(png.readUInt32BE(16)).toBe(1024)
    expect(png.readUInt32BE(20)).toBe(1024)
    expect(png.readUInt8(25)).toBe(6)
  })

  it('shows the same emblem next to the window title', () => {
    const assetPath = path.join(root, 'src', 'renderer', 'src', 'assets', 'app-icon.png')
    expect(fs.existsSync(assetPath)).toBe(true)
    const png = fs.readFileSync(assetPath)
    expect(png.readUInt32BE(16)).toBe(128)
    expect(png.readUInt32BE(20)).toBe(128)
    expect(png.readUInt8(25)).toBe(6)
    const app = fs.readFileSync(path.join(root, 'src/renderer/src/App.tsx'), 'utf8')
    expect(app).toContain("import appIcon from './assets/app-icon.png'")
    expect(app).toContain('className="app-icon"')
    const styles = fs.readFileSync(path.join(root, 'src/renderer/src/styles.css'), 'utf8')
    expect(styles).toContain('width: 18px')
  })
})
