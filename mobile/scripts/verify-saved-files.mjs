import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'

const root = 'F:/AndroidTools/coc-mobile-evidence-20261013'
await build({
  entryPoints: ['src/data/backup.ts'],
  outfile: `${root}/backup-core.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24'
})
const { previewBackup } = await import(pathToFileURL(`${root}/backup-core.mjs`).href)
const expected = await previewBackup(await readFile(`${root}/coc-android-validation-75-sessions.json`))
const actual = await previewBackup(await readFile(`${root}/s9-exported-backup.json`))
const safety = await previewBackup(await readFile(`${root}/s9-before-first-restore.json`))
const businessFieldsMatch = ['modules', 'records', 'characters'].every((key) =>
  isDeepStrictEqual(expected.snapshot[key], actual.snapshot[key])
)
if (!businessFieldsMatch) throw new Error('Exported business fields differ; no private values logged')
process.env.TZ = 'Asia/Shanghai'
await build({
  entryPoints: ['../src/shared/document-renderer.ts'],
  outfile: `${root}/desktop-renderer.cjs`,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24'
})
const require = createRequire(import.meta.url)
const { renderLogText } = require(`${root}/desktop-renderer.cjs`)
const first = [...actual.snapshot.records].sort((a, b) => a.order - b.order)[0]
const txt = await readFile(`${root}/s9-exported-first.txt`, 'utf8')
const txtMatchesDesktopRenderer =
  txt === renderLogText(first.rawContent, actual.snapshot.settings.filterPreset)
if (!txtMatchesDesktopRenderer) throw new Error('TXT does not match desktop renderer')
const report = {
  businessFieldsMatch,
  records: actual.snapshot.records.length,
  characters: actual.snapshot.characters.length,
  offlineRecords: actual.offlineRecords,
  messages: actual.snapshot.records.reduce(
    (sum, record) => sum + (record.rawContent?.messages.length || 0),
    0
  ),
  txtMatchesDesktopRenderer,
  firstSafetyBackupValid: safety.snapshot.records.length === 0,
  oldDesktopMustRejectAndroidEnvelope: !JSON.parse(await readFile(`${root}/s9-exported-backup.json`, 'utf8'))
    .schemaVersion
}
await writeFile(`${root}/s9-saved-file-validation.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
