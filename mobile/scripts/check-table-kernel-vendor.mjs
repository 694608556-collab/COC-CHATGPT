import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const directory = new URL('../native/table-kernel/vendor/expat/', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('UPSTREAM-SHA256.json', directory), 'utf8'))
assert.equal(manifest.version, '2.9.0')
assert.equal(manifest.archiveSHA256, '1e6371862cc31999b368c3b89b49994f0677e1bab5f1b2b85ae3741f5d803051')
assert(manifest.files.some(item => item.path === 'COPYING'), 'Upstream license proof is required')
for (const item of manifest.files) {
  assert(/^[a-zA-Z0-9_.-]+$/.test(item.path), 'Vendor proof must name a direct file')
  const bytes = await readFile(new URL(item.path, directory))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, 'Unmodified upstream file: ' + item.path)
}
