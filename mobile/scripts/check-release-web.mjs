import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const webDirectory = fileURLToPath(new URL('../www/', import.meta.url))
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const source = (await readFile(resolve(webDirectory, 'app.js'), 'utf8')).replace(
  /\\u([0-9a-f]{4})/gi,
  (_, value) => String.fromCharCode(parseInt(value, 16))
)
for (const text of [
  '安卓开发版',
  '启动试验',
  '仅保留你确认的三个模块',
  '开发阶段说明',
  '公开搜索测试数据',
  '载入公开测试数据',
  '浏览器开发预览',
  '模拟长按',
  '模拟左滑',
  '模拟拖动',
  'demo-module-',
  'demo-long',
  'first-launch-preview',
  'coc-logbook-first-welcome-shown',
  '重新构建安装包'
])
  assert(!source.includes(text), `Development-only content in production bundle: ${text}`)
assert(source.includes(version), `Release version missing: ${version}`)
assert(source.includes('亦如长风万里沙'), 'Creator credit missing')
const assets = await readdir(webDirectory, { recursive: true })
assert(!assets.some((name) => name.endsWith('.map')), 'Production source maps must not be shipped')
const fonts = assets.filter((name) => /\.(otf|ttf)$/.test(name))
assert.equal(fonts.length, 8, 'Keep all eight original font assets')
console.log('Release web assets passed: no development prompts, sample or source maps; eight fonts retained.')
