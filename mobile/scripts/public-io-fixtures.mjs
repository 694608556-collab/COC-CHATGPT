import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Fictional fixtures and UI probes stay in instrumentation assets, never release assets.
const ios = process.argv.includes('--ios')
const assets = resolve(ios ? 'ios/build/public-io' : 'android/app/src/androidTest/assets')
await mkdir(assets, { recursive: true })
await mkdir('android/app/build/public-io', { recursive: true })
const generator = resolve(
  ios ? 'ios/build/public-io/fixtures.mjs' : 'android/app/build/public-io/fixtures.mjs'
)
await build({
  entryPoints: ['tests/public-io-fixtures.ts'],
  outfile: generator,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: {
    js: "import {createRequire as publicIoCreateRequire} from 'node:module'; const require=publicIoCreateRequire(import.meta.url);"
  }
})
const generated = spawnSync(process.execPath, [generator, assets], { stdio: 'inherit' })
if (generated.status !== 0) process.exit(generated.status ?? 1)
if (ios) {
  const inputs = {}
  for (const name of [
    'public-io-card.xlsx',
    'public-io-card-spill.xlsx',
    'public-io-card.xls',
    'public-io-table.csv',
    'public-io-table.xlsx',
    'public-io-table.xls'
  ])
    inputs[name] = (await readFile(resolve(assets, name))).toString('base64')
  await writeFile(resolve(assets, 'inputs.json'), JSON.stringify(inputs))
}
await build({
  entryPoints: [ios ? 'tests/ios-public-io.ts' : 'tests/public-io-webview.ts'],
  outfile: resolve(assets, 'public-io-webview.js'),
  bundle: true,
  format: 'iife',
  target: ios ? 'safari17' : 'chrome69'
})
