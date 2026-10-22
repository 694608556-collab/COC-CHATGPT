import { build } from 'esbuild'
await build({
  entryPoints: ['tests/ios-capacity-webview.ts'],
  bundle: true,
  format: 'iife',
  target: 'safari17',
  outfile: 'ios/build/ios-capacity-webview.js'
})
