import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')

describe('third party notices', () => {
  it('lists every direct runtime dependency with a license field', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    for (const name of Object.keys(pkg.dependencies)) expect(notices).toContain('| ' + name + ' |')
    expect(notices).not.toContain('| UNKNOWN |')
  })
})
