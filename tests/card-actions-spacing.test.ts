import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const styles = fs.readFileSync(path.join(root, 'src/renderer/src/styles.css'), 'utf8')

describe('character card action row spacing', () => {
  it('slides the divider and delete button toward the card bottom', () => {
    expect(styles).toContain('.character-card { min-height: 204px; padding-bottom: 8px; }')
  })

  it('keeps the action row pinned to the bottom of the card', () => {
    const index = styles.lastIndexOf('.character-card-actions {')
    const actions = styles.slice(index, index + 160)
    expect(actions).toContain('margin-top: auto')
  })
})
