import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('0.8.2 settings resource overview', () => {
  it('shows the total resource count from the app snapshot', () => {
    const app = read('src/renderer/src/App.tsx')
    expect(app).toContain('<strong>{snapshot.resources.length}</strong>')
    expect(app).toContain('<span>资料</span>')
  })
})
