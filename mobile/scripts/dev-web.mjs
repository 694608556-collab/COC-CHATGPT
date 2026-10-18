import { context } from 'esbuild'
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { resolve } from 'node:path'

await mkdir('www-dev', { recursive: true })
await copyFile('../build/icon.png', 'www-dev/icon.png')
await writeFile(
  'www-dev/index.html',
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=contain"><title>COC 浏览器开发预览</title><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>'
)
const ctx = await context({
  entryPoints: {
    app: 'src/dev/main.tsx',
    'snapshot-worker': 'src/data/snapshot-worker.ts',
    'export-worker': 'src/data/export-worker.ts'
  },
  outdir: 'www-dev',
  banner: { js: 'var globalThis = typeof window !== "undefined" ? window : self;' },
  bundle: true,
  nodePaths: [resolve('node_modules')],
  loader: { '.ttf': 'file', '.otf': 'file' },
  assetNames: 'fonts/[name]-[hash]',
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
  port: 4174
})
const proxy = http.createServer(async (request, response) => {
  try {
    const address = new URL(request.url, 'http://127.0.0.1:4173')
    if (address.pathname === '/_logbook/sea') {
      if (request.method !== 'GET') {
        response.writeHead(405).end()
        return
      }
      let url = new URL(address.searchParams.get('url') || '')
      if (url.origin !== 'https://dice-api.weizaima.com' || url.pathname !== '/dice/api/load_data')
        throw new Error('Unsupported address')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20000)
      try {
        let remote
        for (let redirect = 0; redirect < 4; redirect++) {
          if (
            url.protocol !== 'https:' ||
            !['dice-api.weizaima.com', 'log.weizaima.com'].includes(url.hostname) ||
            url.username ||
            url.password ||
            url.port
          )
            throw new Error('Rejected redirect')
          remote = await fetch(url, {
            headers: { Accept: 'application/json' },
            redirect: 'manual',
            signal: controller.signal
          })
          if ([301, 302, 303, 307, 308].includes(remote.status)) {
            const location = remote.headers.get('location')
            if (!location) throw new Error('Missing redirect')
            await remote.body?.cancel()
            url = new URL(location, url)
            continue
          }
          break
        }
        if (!remote || (remote.status >= 300 && remote.status < 400)) throw new Error('Too many redirects')
        const reader = remote.body?.getReader()
        const chunks = []
        let length = 0
        if (reader)
          while (true) {
            const part = await reader.read()
            if (part.done) break
            length += part.value.length
            if (length > 64 * 1024 * 1024) {
              await reader.cancel()
              throw new Error('Body too large')
            }
            chunks.push(part.value)
          }
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        response.end(
          JSON.stringify({
            status: remote.status,
            url: url.toString(),
            text: Buffer.concat(chunks).toString('utf8')
          })
        )
      } finally {
        clearTimeout(timer)
      }
    } else {
      const forwarded = http.request(
        {
          host: '127.0.0.1',
          port: server.port,
          path: request.url,
          method: request.method,
          headers: request.headers
        },
        (upstream) => {
          response.writeHead(upstream.statusCode || 500, upstream.headers)
          upstream.pipe(response)
        }
      )
      forwarded.on('error', () => {
        response.writeHead(502).end('Development server unavailable')
      })
      request.pipe(forwarded)
    }
  } catch {
    response.writeHead(502).end('Log connection failed')
  }
})
await new Promise((resolve) => proxy.listen(4173, '127.0.0.1', resolve))
console.log('Browser development preview: http://127.0.0.1:4173')
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    proxy.close()
    await ctx.dispose()
    process.exit(0)
  })
