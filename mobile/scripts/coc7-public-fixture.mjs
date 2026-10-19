import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

// CI-only, independently authored fictional workbook; never bundle in the app.
await mkdir('ios/build', { recursive: true })
const output = resolve('ios/build/coc7-public-fixture.cjs')
await build({
  entryPoints: ['test-fixtures/coc7.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24'
})
const { publicCoc7Bytes } = createRequire(import.meta.url)(output)
await writeFile('ios/build/public-coc7.xlsx', publicCoc7Bytes())
console.log('Created fictional XLSX for isolated native file-picker tests.')
