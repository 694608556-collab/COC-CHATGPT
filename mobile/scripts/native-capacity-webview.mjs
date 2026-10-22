import { build } from 'esbuild'
import { resolve } from 'node:path'
await build({
  entryPoints: ['tests/native-capacity-webview.ts'],
  bundle: true,
  format: 'iife',
  target: 'chrome69',
  outfile: 'android/app/src/androidTest/assets/public-capacity-webview.js'
})
await build({
  entryPoints: ['tests/native-table-webview.ts'],
  nodePaths: [resolve('node_modules')],
  bundle: true,
  format: 'iife',
  target: 'chrome69',
  outfile: 'android/app/src/androidTest/assets/public-table-webview.js'
})
