import { context } from 'esbuild'
import { mkdir, copyFile, writeFile } from 'node:fs/promises'

await mkdir('www-dev', { recursive: true })
await copyFile('../build/icon.png', 'www-dev/icon.png')
await writeFile(
  'www-dev/index.html',
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>COC 浏览器开发预览</title><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>'
)
const ctx = await context({
  entryPoints: ['src/dev/main.tsx'],
  outfile: 'www-dev/app.js',
  bundle: true,
  target: 'chrome69',
  format: 'iife',
  jsx: 'automatic',
  sourcemap: true,
  define: { 'process.env.NODE_ENV': '"development"' }
})
await ctx.watch()
const server = await ctx.serve({
  servedir: 'www-dev',
  host: '127.0.0.1',
  port: 4173
})
console.log('Browser development preview: http://127.0.0.1:' + server.port)
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await ctx.dispose()
    process.exit(0)
  })
