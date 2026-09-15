import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('app version display', () => {
  it('reads the version from the main process instead of a hardcoded label', () => {
    expect(read('src/main/ipc.ts')).toContain("register('app:version', empty, () => app.getVersion())")
    expect(read('src/shared/api.ts')).toContain('version(): Promise<string>')
    expect(read('resources/preload.cjs')).toContain("version: () => invoke('app:version')")
    expect(read('src/preload/index.ts')).toContain("version: () => invoke('app:version')")
    const app = read('src/renderer/src/App.tsx')
    expect(app).toContain('setAppVersion(await window.coc.app.version())')
    expect(app).toContain('const versionLabel')
    expect(app).toContain('`V${appVersion}`')
    expect(app).not.toContain('V5.3')
  })
})

describe('installer packaging', () => {
  it('offers a setup build that lets the user choose the install directory', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['package:setup']).toContain('scripts/package-setup.cjs')
    expect(pkg.build.nsis.oneClick).toBe(false)
    expect(pkg.build.nsis.allowToChangeInstallationDirectory).toBe(true)
    expect(pkg.build.nsis.perMachine).toBe(false)
    expect(pkg.build.nsis.artifactName).toContain('-Windows-x64-Setup.')
    expect(pkg.build.win.target[0].target).toBe('portable')
    expect(read('scripts/package-setup.cjs')).toContain("'--win', 'nsis'")
  })
})
