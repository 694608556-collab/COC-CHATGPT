import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('0.8.4 records page scrollbar sizing', () => {
  const styles = read('src/renderer/src/styles.css')

  it('keeps the page scrollbar wider and the module session scrollbar narrower', () => {
    const moduleRule = styles.match(/\.module-records-scroll::-webkit-scrollbar \{[^}]*\}/)?.[0] ?? ''
    const pageRule = styles.match(/\.records-content::-webkit-scrollbar \{[^}]*\}/)?.[0] ?? ''
    expect(moduleRule).toContain('width: 6px')
    expect(pageRule).toContain('width: 16px')
  })

  it('uses the same narrow scrollbar contract for search results and module sessions', () => {
    const sessionRule = styles.match(/\.module-records-scroll::-webkit-scrollbar \{[^}]*\}/)?.[0] ?? ''
    const searchRule = styles.match(/\.module-search-results::-webkit-scrollbar \{[^}]*\}/)?.[0] ?? ''
    expect(searchRule).toContain('width: 6px')
    expect(searchRule).toContain('height: 6px')
    expect(sessionRule).toContain('width: 6px')
    expect(styles).toContain('.module-search-results {\n  scrollbar-width: thin;')
    expect(styles).toContain('.module-records-scroll {\n  max-height: 690px;')
  })

  it('removes native scrollbar buttons and clips the session scroll area to the card', () => {
    const moduleRule = styles.match(/\.module-records-scroll \{[^}]*\}/)?.[0] ?? ''
    expect(moduleRule).toContain('overflow-y: auto')
    expect(moduleRule).toContain('border-radius: 0 0 12px 12px')
    expect(moduleRule).toContain('scrollbar-width: thin')
    expect(moduleRule).toContain('overflow-x: hidden')
    expect(styles).toContain('.module-records-scroll::-webkit-scrollbar-button,')
    expect(styles).toContain('.module-records-scroll::-webkit-scrollbar-button:vertical:decrement,')
    expect(styles).toContain('.module-records-scroll::-webkit-scrollbar-button:vertical:increment,')
    expect(styles).toContain('width: 0 !important')
    expect(styles).toContain('height: 0 !important')
    expect(styles).toContain('display: none')
    expect(styles).toContain('.module-records-viewport {\n  max-height: 690px;\n  overflow: hidden;')
  })
})
