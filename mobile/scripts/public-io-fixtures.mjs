import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Fictional fixtures and UI probes stay in instrumentation assets, never release assets.
const assets = resolve('android/app/src/androidTest/assets')
await mkdir(assets, { recursive: true })
await mkdir('android/app/build/public-io', { recursive: true })
const generator = resolve('android/app/build/public-io/fixtures.mjs')
await build({
  entryPoints: ['tests/public-io-fixtures.ts'],
  outfile: generator,
  bundle: true,
  nodePaths: [resolve('node_modules')],
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: {
    js: "import {createRequire as publicIoCreateRequire} from 'node:module'; const require=publicIoCreateRequire(import.meta.url);"
  }
})
const generated = spawnSync(process.execPath, [generator, assets], { stdio: 'inherit' })
if (generated.status !== 0) process.exit(generated.status ?? 1)
await build({
  entryPoints: ['tests/public-io-webview.ts'],
  outfile: resolve(assets, 'public-io-webview.js'),
  bundle: true,
  nodePaths: [resolve('node_modules')],
  format: 'iife',
  target: 'chrome69'
})
