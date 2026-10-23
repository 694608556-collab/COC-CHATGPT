import { build } from 'esbuild'
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import './check-table-kernel-vendor.mjs'

await mkdir('www', { recursive: true })
await mkdir('www/licenses', { recursive: true })
await copyFile('native/table-kernel/vendor/expat/COPYING', 'www/licenses/expat.txt')
await copyFile('../build/icon.png', 'www/icon.png')
await build({
  entryPoints: {
    app: 'src/main.tsx',
    'snapshot-worker': 'src/data/snapshot-worker.ts',
    'export-worker': 'src/data/export-worker.ts',
    'backup-stream-worker': 'src/data/backup-stream-worker.ts',
    'table-stream-worker': 'src/data/table-stream-worker.ts'
  },
  outdir: 'www',
  banner: { js: 'var globalThis = typeof window !== "undefined" ? window : self;' },
  bundle: true,
  nodePaths: [resolve('node_modules')],
  loader: { '.ttf': 'file', '.otf': 'file' },
  assetNames: 'fonts/[name]-[hash]',
  target: 'chrome69',
  format: 'iife',
  jsx: 'automatic',
  minify: true,
  define: {
    'process.env.NODE_ENV': '"production"',
    '__COC_IMPORT_TEST_OBSERVER__': process.env.COC_PUBLIC_IO_TEST === '1' ? 'true' : 'false'
  }
})
// Keep the WebView inside system/cutout insets via Capacitor SystemBars on all engine versions.
// Generated HTML only loads packaged local assets: there is no remote dev server or sample embedded in the APK.
await writeFile(
  'www/index.html',
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=contain"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'"><title>COC 跑团记录簿</title><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script>window.globalThis=window;</script><script src="app.js"></script></body></html>`
)
