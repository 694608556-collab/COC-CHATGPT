import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')

describe('preload IPC contract', () => {
  it('exposes only named feature APIs and no generic ipc, fs or process bridge', () => {
    const source = fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8')
    expect(source).toContain("contextBridge.exposeInMainWorld('coc', api)")
    expect(source).not.toMatch(/exposeInMainWorld\(['"](?:ipc|fs|process|electron)/)
    expect(source).not.toContain('ipcRenderer.send(')
    for (const group of ['window', 'app', 'modules', 'records', 'characters', 'settings', 'files', 'backup']) {
      expect(source).toContain(group + ':')
    }
  })

  it('maps every renderer operation to a literal main-process channel', () => {
    const preload = fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8')
    const ipc = fs.readFileSync(path.join(root, 'src/main/ipc.ts'), 'utf8')
    const channels = Array.from(preload.matchAll(/invoke\('([^']+)'/g)).map((match) => match[1]!)
    expect(channels.length).toBeGreaterThan(20)
    for (const channel of channels) expect(ipc).toContain("'" + channel + "'")
  })
})
