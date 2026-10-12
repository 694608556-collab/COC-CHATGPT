import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const destination = 'F:/AndroidTools/coc-mobile-evidence-20261013'
await mkdir(destination, { recursive: true })
await build({
  entryPoints: ['src/data/backup.ts'],
  outfile: `${destination}/backup-core.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24'
})
const { previewBackup, encodeBackup } = await import(pathToFileURL(`${destination}/backup-core.mjs`).href)
const oldZip = await readFile('../dist/data/backups/coc-backup-20261012-2057.zip')
if (
  createHash('sha256').update(oldZip).digest('hex').toUpperCase() !==
  'BCCD75A3D231BE6FCB4A01AE12DDBA36FE7E31AAABAA0DBD267F62A36DD5C5FD'
)
  throw new Error('Original sample changed; stop')
const oldPreview = await previewBackup(oldZip)
const fixture = JSON.parse(
  await readFile('F:/AndroidTools/coc-android-spike/private-input/fixture.json', 'utf8')
)
const logs = new Map(fixture.logs.map((item) => [item.recordId, item]))
const payload = {
  ...fixture.backup,
  schemaVersion: oldPreview.snapshot.schemaVersion,
  exportedAt: oldPreview.snapshot.exportedAt,
  records: fixture.backup.records.map((record) => {
    const saved = logs.get(record.id)
    if (!saved || saved.sourceUrl !== record.link) throw new Error('Sample log/source association mismatch')
    return { ...record, rawContent: saved.log, fetchedAt: saved.fetchedAt, cacheSourceUrl: saved.sourceUrl }
  })
}
const preview = await previewBackup(new TextEncoder().encode(JSON.stringify(payload)))
let messages = 0
for (const record of preview.snapshot.records) {
  const source = logs.get(record.id).log.messages
  if (
    record.rawContent.messages.length !== source.length ||
    record.rawContent.messages.some((message, index) => message.text !== source[index].text)
  )
    throw new Error('Sample text changed during validation')
  messages += source.length
}
if (preview.offlineRecords !== 75 || messages !== 24279 || preview.snapshot.characters.length !== 1)
  throw new Error('Real-sample count mismatch')
const bytes = encodeBackup(preview.snapshot)
const path = `${destination}/coc-android-validation-75-sessions.json`
await writeFile(path, bytes)
const report = {
  oldZip: {
    modules: oldPreview.snapshot.modules.length,
    records: oldPreview.snapshot.records.length,
    characters: oldPreview.snapshot.characters.length,
    offlineRecords: oldPreview.offlineRecords
  },
  androidSample: {
    records: preview.snapshot.records.length,
    characters: preview.snapshot.characters.length,
    offlineRecords: preview.offlineRecords,
    messages,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    allSourceMessageTextUnchanged: true
  },
  privateDoNotDistribute: true
}
await writeFile(`${destination}/sample-validation.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
