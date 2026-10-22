import { build } from 'esbuild'
import { resolve } from 'node:path'
await build({
  entryPoints: ['tests/ios-capacity-webview.ts'],
  bundle: true,
  nodePaths: [resolve('node_modules')],
  format: 'iife',
  target: 'safari17',
  outfile: 'ios/build/ios-capacity-webview.js'
})
