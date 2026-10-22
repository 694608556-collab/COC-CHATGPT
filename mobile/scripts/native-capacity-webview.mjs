import { build } from 'esbuild'
await build({
  entryPoints: ['tests/native-capacity-webview.ts'],
  bundle: true,
  format: 'iife',
  target: 'chrome69',
  outfile: 'android/app/src/androidTest/assets/public-capacity-webview.js'
})
