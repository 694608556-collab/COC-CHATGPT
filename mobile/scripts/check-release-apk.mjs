import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, basename, extname } from 'node:path'
import { unzipSync } from 'fflate'

assert(process.argv[2], 'Pass the signed release APK path')
const root = fileURLToPath(new URL('../', import.meta.url))
const files = unzipSync(await readFile(process.argv[2]))
const entries = Object.keys(files)
for (const file of ['app.js', 'app.css', 'index.html', 'snapshot-worker.js']) {
  const actual = files[`assets/public/${file}`]
  assert(actual, `Missing APK web asset: ${file}`)
  assert.deepEqual(Buffer.from(actual), await readFile(resolve(root, 'www', file)))
}
const fonts = entries.filter((name) => /^assets\/public\/fonts\/.*\.(otf|ttf)$/.test(name))
assert.equal(fonts.length, 8, 'APK must include all eight original fonts')
for (const name of fonts) {
  const originalName = basename(name).replace(/-[A-Z0-9]+(?=\.(otf|ttf)$)/, '')
  assert.deepEqual(
    Buffer.from(files[name]),
    await readFile(resolve(root, '../src/renderer/src/assets/fonts', originalName)),
    `Font changed: ${originalName}`
  )
}
for (const name of entries) {
  assert(
    !['.p12', '.pfx', '.jks', '.keystore', '.password', '.map', '.db', '.sqlite'].includes(extname(name)),
    `Private or debug artifact in APK: ${name}`
  )
  assert(
    !/backup\.json$|phone-before|public-search-names|public-startup|coc-public-gesture/.test(name),
    `Private/test data in APK: ${name}`
  )
}
const config = JSON.parse(new TextDecoder().decode(files['assets/capacitor.config.json']))
assert.equal(config.appId, 'coc.logbook')
assert.equal(config.appName, 'COC 跑团记录簿')
assert(!config.server?.url, 'Production APK must not point to a development server')
assert(
  config.android?.webContentsDebuggingEnabled !== true,
  'Production WebView debugging must not be forced on'
)
console.log(
  JSON.stringify({
    package: config.appId,
    webAssetsMatch: true,
    originalFonts: fonts.length,
    noPrivateOrDebugFiles: true
  })
)
