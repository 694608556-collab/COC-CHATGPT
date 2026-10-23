import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { deserialize } from 'node:v8'
import { build } from 'esbuild'

// Public originals only. Compare the actual host C API with production Zod;
// this is compiler/ABI evidence, never physical-iPhone acceptance.
const binary = path.resolve(process.argv[2] ?? 'ios/build/table-kernel-host/coc-search-json-probe')
const directory = path.resolve('ios/build/search-json-host-' + crypto.randomUUID())
fs.mkdirSync(directory, { recursive: true })
const run = (program, args) => {
  const result = spawnSync(program, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) throw Error('Public host search kernel verification failed')
  return result.stdout
}
await build({ entryPoints: ['tests/search-kernel-corpus.ts'], outfile: directory + '/corpus.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node24', nodePaths: [path.resolve('node_modules')], logLevel: 'error' })
run(process.execPath, [directory + '/corpus.cjs', directory])
const proof = JSON.parse(run(binary, []))
assert.equal(proof.passed, true)
assert.equal(proof.searchJsonCases, 49)
assert.equal(proof.searchableCases, 16)
assert.equal(proof.searchScanCases, 384)
const expected = deserialize(fs.readFileSync(directory + '/public-corpus.expected.bin'))
const rows = run(binary, ['--corpus', directory + '/public-corpus.jsonl']).trimEnd().split(/\r?\n/).map(row => JSON.parse(row))
assert.equal(rows.length, expected.length)
for (let index = 0; index < rows.length; index++) assert.deepEqual(rows[index], expected[index].expected, expected[index].name)
const bodyExpected = deserialize(fs.readFileSync(directory + '/body-corpus.expected.bin'))
assert.equal(bodyExpected.length, 423)
const bodies = run(binary, ['--body-corpus', directory + '/body-corpus.jsonl']).trimEnd().split(/\r?\n/).map(row => JSON.parse(row))
assert.equal(bodies.length, bodyExpected.length)
for (let index = 0; index < bodies.length; index++) assert.deepEqual(bodies[index], bodyExpected[index].expected, bodyExpected[index].name)
const summary = { ...proof, publicDifferentialCases: rows.length, publicBodyDifferentialCases: bodies.length, physicalPhone: false }
fs.writeFileSync(directory + '/summary.json', JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary))
