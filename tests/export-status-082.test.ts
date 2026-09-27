import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('0.8.2 export status handling', () => {
  it('does not turn a completed file operation into a failure when UI refresh fails', () => {
    const app = read('src/renderer/src/App.tsx')
    expect(app).toContain('const refreshAfterFileOperation = async (): Promise<void>')

    const exportRecord = app.slice(app.indexOf('const exportRecord'), app.indexOf('const createBackup'))
    expect(exportRecord).toContain('await refreshAfterFileOperation()')
    expect(exportRecord).not.toContain('await refresh()')

    const executeExport = app.slice(app.indexOf('const executeExport'), app.indexOf('const saveModule'))
    expect(executeExport).toContain('await refreshAfterFileOperation()')
    expect(executeExport).not.toContain('await refresh()')
  })
})
