import { build } from 'esbuild'
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

await mkdir('www', { recursive: true })
const ios = process.env.COC_PLATFORM === 'ios'
// Bound iPhone focus zoom without changing the shared input font or control sizes.
const viewport = ios
  ? 'width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover'
  : 'width=device-width,initial-scale=1,viewport-fit=contain'
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
  define: { 'process.env.NODE_ENV': '"production"' }
})
// Android uses Capacitor insets; iOS paints its own full-screen safe-area header.
// Generated HTML only loads packaged local assets: there is no remote dev server or sample embedded in the APK.
await writeFile(
  'www/index.html',
  `<!doctype html><html lang="zh-CN"${ios ? ' data-platform="ios"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="${viewport}"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'"><title>COC 跑团记录簿</title><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script>window.globalThis=window;</script><script src="app.js"></script></body></html>`
)
