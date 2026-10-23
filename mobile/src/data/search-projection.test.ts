import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { exampleBackup } from './fixtures'
import { readSearchProjection } from './search-projection'
import { readBackupJsonStream } from './backup-stream'
import { searchNativeBodies } from './backup-stream-client'
import type { LogbookPort } from './native'
import { DEFAULT_FILTER_PRESET } from '../../../src/shared/types'
import { searchBodyStream } from './body-search-stream'

afterEach(() => vi.unstubAllGlobals())
it('native projection reader retains every schema and graph check and matches complete reader records', async () => {
  const seed = exampleBackup()
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
  const bytes = encode({ format: 'coc.logbook.android', formatVersion: 1, snapshot: seed })
  const source = {
    url: 'https://localhost/_capacitor_file_/public',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
  vi.stubGlobal('location', new URL('https://localhost/'))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes.slice().buffer))
  )
  const rows: unknown[] = []
  const fast = await readSearchProjection(source, {
    maximumBytes: bytes.length,
    expectedSource: source,
    stageRecord: async (row) => {
      rows.push(row)
    }
  })
  const fullRows: unknown[] = []
  const full = await readBackupJsonStream(
    (async function* () {
      yield bytes
    })(),
    {
      maximumBytes: bytes.length,
      expectedSource: source,
      stageRecord: async (row) => {
        fullRows.push(row)
      }
    }
  )
  expect(rows).toEqual(fullRows)
  expect(fast).toEqual(full)
  for (const mutate of [
    (value: typeof seed) => {
      value.records[0]!.rawContent!.messages[0]!.isOffTopic = 'false' as never
    },
    (value: typeof seed) => {
      value.records[0]!.moduleId = 'missing'
    },
    (value: typeof seed) => {
      value.records.push(value.records[0]!)
    },
    (value: typeof seed) => {
      Object.assign(value.records[0]!.rawContent!, { sourceUrl: 'https://example.invalid/other' })
    }
  ]) {
    const value = structuredClone(seed)
    mutate(value)
    const bad = encode({ format: 'coc.logbook.android', formatVersion: 1, snapshot: value })
    vi.mocked(fetch).mockResolvedValueOnce(new Response(bad.buffer))
    const proof = { ...source, bytes: bad.length, sha256: createHash('sha256').update(bad).digest('hex') }
    await expect(
      readSearchProjection(proof, {
        maximumBytes: bad.length,
        expectedSource: proof,
        stageRecord: async () => {}
      })
    ).rejects.toThrow()
  }
  await expect(
    readSearchProjection(
      { ...source, sha256: '0'.repeat(64) },
      { maximumBytes: bytes.length, stageRecord: async () => {} }
    )
  ).rejects.toThrow()
})

it('a forged caller port cannot attest duplicate-key JSON or activate the native reader', async () => {
  const bytes = new TextEncoder().encode(
    JSON.stringify(exampleBackup()).replace('"id":"r1"', '"id":"other","id":"r1"')
  )
  const proof = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  vi.stubGlobal('location', new URL('https://localhost/'))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes.slice().buffer))
  )
  const forbidden = vi.fn(async () => {
    throw new Error('Unexpected write')
  })
  const cancel = vi.fn(async () => {})
  const port = {
    createSearchSource: async () => ({
      id: 'forged',
      revision: 7,
      source: { fileUri: 'https://localhost/_capacitor_file_/public', ...proof },
      searchProjectionVersion: 1,
      originalSource: proof,
      maximumReadBytes: bytes.length
    }),
    getStatus: async () => ({ revision: 7 }),
    cancelBackupStage: cancel,
    appendBackupStage: forbidden,
    finishBackupPreview: forbidden,
    commitBackupRestore: forbidden,
    createBackupStream: forbidden,
    finishBackupExport: forbidden
  } as unknown as LogbookPort
  await expect(
    searchNativeBodies(port, ['r1'], 7, '离线', DEFAULT_FILTER_PRESET, new AbortController().signal)
  ).rejects.toThrow('重复')
  expect(cancel).toHaveBeenCalledOnce()
  expect(forbidden).not.toHaveBeenCalled()
})

it('compact native tuples preserve optional null versus missing and exactly match complete search records', async () => {
  const seed = exampleBackup(),
    original = structuredClone(seed)
  const message = seed.records[0]!.rawContent!.messages[0]!
  const fields = [
    'id',
    'order',
    'timestamp',
    'displayName',
    'platformAccount',
    'text',
    'type',
    'isDiceCommand',
    'isOffTopic',
    'images'
  ]
  const bits = fields.reduce(
    (bits, key, i) => bits | (Object.prototype.hasOwnProperty.call(message, key) ? 1 << i : 0),
    0
  )
  ;(seed.records[0]!.rawContent as any).messages = [
    [bits, ...fields.map((key) => (message as any)[key] ?? null)]
  ]
  const bytes = new TextEncoder().encode(
    JSON.stringify({ format: 'coc.logbook.android', formatVersion: 1, snapshot: seed })
  )
  const source = {
    url: 'https://localhost/_capacitor_file_/public',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
  vi.stubGlobal('location', new URL('https://localhost/'))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes.slice().buffer))
  )
  const staged: unknown[] = []
  await readSearchProjection(source, {
    maximumBytes: bytes.length,
    searchProjectionVersion: 2,
    stageRecord: async (row) => {
      staged.push(row)
    }
  })
  expect(staged).toEqual(original.records)
  const bad = structuredClone(seed)
  ;(bad.records[0]!.rawContent as any).messages[0][0] |= 1 << 2
  const broken = new TextEncoder().encode(
    JSON.stringify({ format: 'coc.logbook.android', formatVersion: 1, snapshot: bad })
  )
  vi.mocked(fetch).mockResolvedValueOnce(new Response(broken.buffer))
  await expect(
    readSearchProjection(
      { ...source, bytes: broken.length, sha256: createHash('sha256').update(broken).digest('hex') },
      { maximumBytes: broken.length, searchProjectionVersion: 2, stageRecord: async () => {} }
    )
  ).rejects.toThrow()
})

it('schema-attested search tuples yield the same complete hits while retaining proof, graph and selection gates', async () => {
  const original = exampleBackup()
  const message = original.records[0]!.rawContent!.messages[0]!
  message.text = '完整正文😀离线\n离线END'
  const projected = structuredClone(original)
  ;(projected.records[0]!.rawContent as any).messages = [
    [null, message.displayName, null, message.text, false, false, false]
  ]
  const encode = (snapshot: unknown) =>
    new TextEncoder().encode(JSON.stringify({ format: 'coc.logbook.android', formatVersion: 1, snapshot }))
  const prove = (bytes: Uint8Array) => ({
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  })
  const bytes = encode(projected),
    fullBytes = encode(original)
  const source = { url: 'https://localhost/_capacitor_file_/public', ...prove(bytes), version: 3 as const }
  vi.stubGlobal('location', new URL('https://localhost/'))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes.slice().buffer))
  )
  const settings = { ids: ['r1'], query: '离线', preset: DEFAULT_FILTER_PRESET }
  const full = await searchBodyStream(
    (async function* () {
      yield fullBytes
    })(),
    { ...settings, expectedSource: prove(fullBytes) }
  )
  const fast = await searchBodyStream(
    (async function* () {
      throw new Error('Native full proof must be read through its local source')
    })(),
    { ...settings, expectedSource: source, nativeProjection: source }
  )
  expect(fast.hits).toEqual(full.hits)
  expect(fast.records).toBe(full.records)
  expect(fast.hits[0]!.matches).toBe(2)
  for (const mutate of [
    (seed: typeof projected) => {
      seed.records[0]!.moduleId = 'missing'
    },
    (seed: typeof projected) => {
      seed.records.push(structuredClone(seed.records[0]!))
    },
    (seed: typeof projected) => {
      ;(seed.records[0]!.rawContent as any).messages[0][4] = 'false'
    },
    (seed: typeof projected) => {
      ;(seed.records[0]!.rawContent as any).sourceUrl = 'https://example.invalid/mismatch'
    }
  ]) {
    const bad = structuredClone(projected)
    mutate(bad)
    const broken = encode(bad),
      credential = { ...source, ...prove(broken) }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(broken.buffer))
    await expect(
      searchBodyStream((async function* () {})(), {
        ...settings,
        expectedSource: credential,
        nativeProjection: credential
      })
    ).rejects.toThrow()
  }
  await expect(
    searchBodyStream((async function* () {})(), {
      ...settings,
      ids: ['wrong'],
      expectedSource: source,
      nativeProjection: source
    })
  ).rejects.toThrow('场次')
})
