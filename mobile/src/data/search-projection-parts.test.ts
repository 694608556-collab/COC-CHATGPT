import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { exampleBackup } from './fixtures'
import { searchBodyParts, searchBodyStream } from './body-search-stream'
import type { SearchProjectionPart, SearchProjectionParts } from './search-projection-parts'
import type { StreamProof } from './backup-stream'
import {
  DEFAULT_FILTER_PRESET,
  type CharacterData,
  type FilterPreset,
  type SessionRecord
} from '../../../src/shared/types'

const cache = vi.hoisted(() => ({ begin: vi.fn(), append: vi.fn(), commit: vi.fn(), close: vi.fn() }))
vi.mock('./body-search-cache', () => ({ beginBodySearchCache: cache.begin }))

beforeEach(() => {
  vi.clearAllMocks()
  cache.append.mockResolvedValue(undefined)
  cache.commit.mockResolvedValue(true)
  cache.begin.mockResolvedValue({ append: cache.append, commit: cache.commit, close: cache.close })
  vi.stubGlobal('location', new URL('https://localhost/'))
})
afterEach(() => vi.unstubAllGlobals())

type Snapshot = Omit<ReturnType<typeof exampleBackup>, 'records' | 'characters' | 'modules'> & {
  records: SessionRecord[]
  characters: CharacterData[]
  modules: Array<
    Omit<ReturnType<typeof exampleBackup>['modules'][number], 'pairs'> & {
      pairs: Array<{ pc: string; pl: string; characterId?: string }>
    }
  >
}
type ProjectedSnapshot = Omit<Snapshot, 'records'> & { records: Record<string, unknown>[] }
type WirePart = { kind: SearchProjectionPart['kind']; bytes: Uint8Array }
const encode = (text: string) => new TextEncoder().encode(text)
const proof = (bytes: Uint8Array): StreamProof => ({
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex')
})
const concatenate = (parts: WirePart[]) => new Uint8Array(Buffer.concat(parts.map((part) => part.bytes)))
const cacheSettings = {
  generation: 'public-parts-generation',
  signature: 'public-parts-signature',
  maximumMemoryBytes: 1024
}

/** Public independent full-reader fixture, including a complete reference graph and a long final message. */
function fixture(): Snapshot {
  const seed = exampleBackup(),
    record = seed.records[0]! as SessionRecord
  const first = record.rawContent!.messages[0]!
  const character: CharacterData = {
    id: 'c1',
    moduleId: 'm1',
    moduleIds: ['m1'],
    edition: 7,
    basic: { name: '公开角色', occupation: '', age: '', gender: '', birthplace: '', residence: '' },
    attrs: { STR: 50, CON: 50, SIZ: 50, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50 },
    editionSnapshots: {},
    derived: { hpCurrent: 10, mpCurrent: 10, sanCurrent: 50, db: '0' },
    occupationFormula: '',
    skills: [],
    weapons: [],
    items: [],
    background: {},
    story: '',
    createdAt: '',
    updatedAt: ''
  }
  const messages = [
    {
      ...first,
      id: 'p1',
      order: 0,
      timestamp: '2026-10-24T00:01:00Z',
      platformAccount: '公开账号😀',
      text: '开始😀\r\n离线第一处\0e\u0301'
    },
    {
      ...first,
      id: 'p2',
      order: 1,
      timestamp: '2026-10-24T00:01:00Z',
      isDiceCommand: true,
      text: '.ra 离线骰点'
    },
    { ...first, id: 'p3', order: 2, text: ' \u3000（离线旁白）' },
    { ...first, id: 'p4', order: 3, text: '正文[cQ:image,file=public]离线图片' },
    {
      ...first,
      id: 'p5',
      order: 4,
      text: '离线附件',
      images: [{ url: 'https://example.invalid/public.png' }]
    },
    { ...first, id: 'p6', order: 5, text: '' },
    { ...first, id: 'p7', order: 6, text: '界'.repeat(40000) + '离线全文尾部' }
  ]
  const { rawContent: _raw, link: _link, ...manualMetadata } = record
  return {
    ...seed,
    modules: [{ ...seed.modules[0]!, pairs: [{ pc: '公开角色', pl: '公开玩家', characterId: 'c1' }] }],
    characters: [character],
    records: [
      { ...record, rawContent: { ...record.rawContent!, sourceUrl: record.link, messages } },
      {
        ...record,
        id: 'r2',
        name: '第二场',
        order: 1,
        sequenceNo: 2,
        rawContent: {
          ...record.rawContent!,
          messages: [
            {
              ...first,
              id: 'p8',
              timestamp: 'not-a-date',
              displayName: '离线发言者',
              platformAccount: '离线账号',
              text: '第二场离线正文'
            }
          ]
        }
      },
      {
        ...manualMetadata,
        id: 'r3',
        name: '手动场',
        order: 2,
        sequenceNo: 3,
        sourceType: 'manual',
        status: 'manual',
        manualContent: '手动离线甲\r\n\r\n手动😀离线乙\r尾部'
      }
    ]
  }
}

/** Convert already-valid public messages to the seven fields emitted by native v3. */
function project(snapshot: Snapshot): ProjectedSnapshot {
  return {
    ...structuredClone(snapshot),
    records: snapshot.records.map((record) => {
      if (!record.rawContent) return structuredClone(record) as unknown as Record<string, unknown>
      return {
        ...structuredClone(record),
        rawContent: {
          ...record.rawContent,
          messages: record.rawContent.messages.map((message) => [
            message.timestamp ?? null,
            message.displayName,
            message.platformAccount ?? null,
            message.text,
            message.isDiceCommand,
            message.isOffTopic,
            message.images.length > 0
          ])
        }
      }
    })
  }
}

/** The wire format is literal JSON fragments; the final proof covers their original concatenated bytes. */
function wire(snapshot = project(fixture()), groupSizes = [1, 2]): WirePart[] {
  const { records, ...metadata } = snapshot
  const prefix = JSON.stringify({ format: 'coc.logbook.android', formatVersion: 1, snapshot: metadata })
  const parts: WirePart[] = [{ kind: 'root', bytes: encode(prefix.slice(0, -2) + ',"records":[') }]
  let offset = 0
  for (const size of groupSizes) {
    const group = records.slice(offset, offset + size)
    parts.push({
      kind: 'records',
      bytes: encode((offset ? ',' : '') + group.map((record) => JSON.stringify(record)).join(','))
    })
    offset += size
  }
  if (offset !== records.length) throw new Error('Public test fixture did not group every record')
  parts.push({ kind: 'tail', bytes: encode(']}}') })
  return parts
}

/** Serve exact fixture bytes by private local URLs, independently of each advertised credential. */
function transport(parts = wire()) {
  const files = new Map<string, Uint8Array>()
  const descriptors: SearchProjectionPart[] = parts.map((part, index) => {
    const url = `https://localhost/_capacitor_file_/public-projection-${index}.json`
    files.set(url, part.bytes.slice())
    return { index, kind: part.kind, source: { url, ...proof(part.bytes) } }
  })
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const bytes = files.get(String(url))
    return bytes ? new Response(bytes.slice().buffer) : new Response('', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  const all = concatenate(parts)
  const finalProof = { ...proof(all), chunks: parts.length }
  const input: SearchProjectionParts = {
    parts: (async function* () {
      yield* descriptors
    })(),
    sealed: Promise.resolve(finalProof),
    maximumReadBytes: all.length
  }
  return { input, descriptors, files, fetchMock, finalProof }
}

const settings = (preset: FilterPreset = DEFAULT_FILTER_PRESET) => ({
  ids: ['r1', 'r2', 'r3'],
  query: '离线',
  preset
})
const cached = (preset?: FilterPreset) => ({ ...settings(preset), cache: cacheSettings })

async function fullSearch(snapshot: Snapshot, preset: FilterPreset, query = '离线') {
  const bytes = encode(JSON.stringify({ format: 'coc.logbook.android', formatVersion: 1, snapshot }))
  return searchBodyStream(
    (async function* () {
      yield bytes
    })(),
    {
      ids: snapshot.records.map((record) => record.id),
      query,
      preset,
      expectedSource: proof(bytes)
    }
  )
}

it('complete grouped v3 search equals the original reader for every filter combination and the final Unicode body', async () => {
  const original = fixture(),
    parts = wire(project(original))
  const flags = Object.keys(DEFAULT_FILTER_PRESET) as Array<keyof FilterPreset>
  for (let mask = 0; mask < 1 << flags.length; mask++) {
    const preset = { ...DEFAULT_FILTER_PRESET }
    flags.forEach((flag, bit) => {
      preset[flag] = Boolean(mask & (1 << bit))
    })
    const expected = await fullSearch(original, preset)
    const source = transport(parts)
    const actual = await searchBodyParts(source.input, settings(preset))
    expect(actual.hits, `filter mask ${mask}`).toEqual(expected.hits)
    expect(actual.records).toBe(3)
    expect(actual.source).toEqual({ bytes: source.finalProof.bytes, sha256: source.finalProof.sha256 })
  }
  const source = transport(parts)
  const tail = await searchBodyParts(source.input, { ...settings(), query: '全文尾部' })
  expect(tail.hits.map((hit) => [hit.id, hit.matches])).toEqual([['r1', 1]])
  expect(tail.hits[0]!.excerpt).toContain('离线全文尾部')
}, 30000)

it('one record per part and several complete records per part have identical hits and source order', async () => {
  const a = await searchBodyParts(transport(wire(project(fixture()), [1, 1, 1])).input, settings())
  const b = await searchBodyParts(transport(wire(project(fixture()), [3])).input, settings())
  expect(a.hits).toEqual(b.hits)
  expect(a.hits.map((hit) => hit.id)).toEqual(['r1', 'r2', 'r3'])
})

it('transferred local reads retain independent whole-byte and URL proof checks without a second fetch', async () => {
  const expected = await fullSearch(fixture(), DEFAULT_FILTER_PRESET)
  for (const broken of ['none', 'short', 'changed', 'foreign']) {
    const source = transport()
    for (const descriptor of source.descriptors)
      descriptor.prefetched = source.files.get(descriptor.source.url)!.slice().buffer as ArrayBuffer
    if (broken === 'short') source.descriptors[1]!.prefetched = source.descriptors[1]!.prefetched!.slice(1)
    if (broken === 'changed') {
      const bytes = new Uint8Array(source.descriptors[1]!.prefetched!)
      bytes[20] = bytes[20]! ^ 1
    }
    if (broken === 'foreign')
      source.descriptors[1]!.source.url = 'https://example.invalid/_capacitor_file_/public'
    if (broken === 'none')
      expect((await searchBodyParts(source.input, settings())).hits).toEqual(expected.hits)
    else await expect(searchBodyParts(source.input, cached())).rejects.toThrow()
    expect(source.fetchMock).not.toHaveBeenCalled()
  }
})

it('root followed directly by exact tail is valid for an empty selected record set', async () => {
  const snapshot = fixture()
  snapshot.records = []
  const source = transport(wire(project(snapshot), []))
  const result = await searchBodyParts(source.input, { ...settings(), ids: [] })
  expect(result.hits).toEqual([])
  expect(result.records).toBe(0)
  expect(result.source).toEqual({ bytes: source.finalProof.bytes, sha256: source.finalProof.sha256 })
})

it('cache publication waits for EOF, the complete final proof and all record/graph checks', async () => {
  const source = transport()
  let seal!: (value: typeof source.finalProof) => void
  source.input.sealed = new Promise((resolve) => {
    seal = resolve
  })
  const pending = searchBodyParts(source.input, cached())
  await vi.waitFor(() => expect(source.fetchMock).toHaveBeenCalledTimes(4))
  expect(cache.commit).not.toHaveBeenCalled()
  seal(source.finalProof)
  const result = await pending
  expect(result.cacheReady).toBe(true)
  expect(cache.begin).toHaveBeenCalledExactlyOnceWith(
    cacheSettings.generation,
    cacheSettings.signature,
    cacheSettings.maximumMemoryBytes
  )
  expect(cache.append.mock.calls.map((call) => [call[0], call[1]])).toEqual([
    ['r1', 0],
    ['r2', 1],
    ['r3', 2]
  ])
  expect(cache.append.mock.calls[0]![2].at(-1).text).toBe('界'.repeat(40000) + '离线全文尾部')
  expect(cache.commit).toHaveBeenCalledOnce()
  expect(cache.close).toHaveBeenCalledOnce()
})

it.each([
  ['missing root', [1, 2, 3]],
  ['missing records part', [0, 2, 3]],
  ['missing tail', [0, 1, 2]],
  ['out of order', [0, 2, 1, 3]],
  ['duplicate part', [0, 1, 1, 2, 3]],
  ['part after tail', [0, 1, 2, 3, 1]],
  ['tail before records', [0, 3, 1, 2]],
  ['empty stream', []]
] as const)('rejects %s without publishing the staged cache', async (_name, order) => {
  const source = transport()
  source.input.parts = (async function* () {
    for (const index of order) yield source.descriptors[index]!
  })()
  await expect(searchBodyParts(source.input, cached())).rejects.toThrow()
  expect(cache.commit).not.toHaveBeenCalled()
  expect(cache.close).toHaveBeenCalledOnce()
})

it.each([-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid part index %s even when bytes and final proof are valid',
  async (index) => {
    const source = transport()
    source.descriptors[1]!.index = index
    await expect(searchBodyParts(source.input, cached())).rejects.toThrow()
    expect(cache.commit).not.toHaveBeenCalled()
  }
)

it.each(['records after tail', 'second tail', 'second root'] as const)(
  'rejects %s with continuous indices and correctly recomputed proofs',
  async (kind) => {
    const parts = wire()
    if (kind === 'records after tail') parts.push({ kind: 'records', bytes: parts[2]!.bytes.slice() })
    else if (kind === 'second tail') parts.push({ kind: 'tail', bytes: encode(']}}') })
    else parts.splice(2, 0, { kind: 'root', bytes: parts[0]!.bytes.slice() })
    await expect(searchBodyParts(transport(parts).input, cached())).rejects.toThrow()
    expect(cache.commit).not.toHaveBeenCalled()
  }
)

it.each([
  ['first records group starts with comma', 1, (text: string) => ',' + text],
  ['later records group lacks comma', 2, (text: string) => text.slice(1)],
  ['later records group starts with whitespace before comma', 2, (text: string) => ' ' + text],
  ['empty first records group', 1, () => ' '],
  ['empty later records group', 2, () => ','],
  ['array instead of a record group', 1, (text: string) => '[' + text + ']'],
  ['trailing comma in records group', 2, (text: string) => text + ','],
  ['corrupt tail', 3, () => ']},{}'],
  ['truncated tail', 3, () => ']}'],
  ['tail has extra whitespace', 3, () => ']}}\n'],
  ['tail has extra JSON', 3, () => ']}}{}'],
  ['root has wrong format', 0, (text: string) => text.replace('coc.logbook.android', 'other.format')],
  [
    'root has wrong format version',
    0,
    (text: string) => text.replace('"formatVersion":1', '"formatVersion":2')
  ]
] as const)(
  'rejects %s even with recomputed per-part and whole-source proofs',
  async (_name, index, mutate) => {
    const parts = wire()
    parts[index]!.bytes = encode(mutate(new TextDecoder().decode(parts[index]!.bytes)))
    await expect(searchBodyParts(transport(parts).input, cached())).rejects.toThrow()
    expect(cache.commit).not.toHaveBeenCalled()
  }
)

it('rejects an unfinished record split across individually valid UTF-8 parts', async () => {
  const parts = wire(),
    text = new TextDecoder().decode(parts[1]!.bytes)
  const cut = text.indexOf('离线') + 1
  parts.splice(
    1,
    1,
    { kind: 'records', bytes: encode(text.slice(0, cut)) },
    { kind: 'records', bytes: encode(',' + text.slice(cut)) }
  )
  await expect(searchBodyParts(transport(parts).input, cached())).rejects.toThrow()
  expect(cache.commit).not.toHaveBeenCalled()
})

it('rejects invalid UTF-8 in a late part even when all byte and digest proofs are correct', async () => {
  const parts = wire(),
    old = parts[2]!.bytes
  const bytes = new Uint8Array(old.length + 1)
  bytes.set(old)
  bytes[old.length] = 0xff
  parts[2]!.bytes = bytes
  await expect(searchBodyParts(transport(parts).input, cached())).rejects.toThrow()
  expect(cache.append).toHaveBeenCalled()
  expect(cache.commit).not.toHaveBeenCalled()
})

it.each([
  ['root', 0],
  ['first records', 1],
  ['later records', 2],
  ['tail', 3]
] as const)('never silently strips a BOM at the %s boundary', async (_name, index) => {
  const parts = wire(),
    bytes = new Uint8Array(parts[index]!.bytes.length + 3)
  bytes.set([0xef, 0xbb, 0xbf])
  bytes.set(parts[index]!.bytes, 3)
  parts[index]!.bytes = bytes
  await expect(searchBodyParts(transport(parts).input, cached())).rejects.toThrow()
  expect(cache.commit).not.toHaveBeenCalled()
})

it.each(['length', 'sha256', 'changed bytes'] as const)(
  'rejects a late per-part %s mismatch after earlier rows were staged',
  async (failure) => {
    const source = transport(),
      part = source.descriptors[2]!
    if (failure === 'length') part.source.bytes++
    else if (failure === 'sha256') part.source.sha256 = '0'.repeat(64)
    else {
      const bytes = source.files.get(part.source.url)!.slice()
      bytes[bytes.length - 2] = bytes[bytes.length - 2]! ^ 1
      source.files.set(part.source.url, bytes)
    }
    await expect(searchBodyParts(source.input, cached())).rejects.toThrow()
    expect(cache.append).toHaveBeenCalled()
    expect(cache.commit).not.toHaveBeenCalled()
  }
)

it.each(['bytes', 'sha256', 'chunks', 'fractional chunks', 'negative chunks'] as const)(
  'rejects incorrect sealed %s after reading every valid part',
  async (failure) => {
    const source = transport(),
      sealed = { ...source.finalProof }
    if (failure === 'bytes') sealed.bytes++
    else if (failure === 'sha256') sealed.sha256 = '0'.repeat(64)
    else if (failure === 'fractional chunks') sealed.chunks += 0.5
    else if (failure === 'negative chunks') sealed.chunks = -1
    else sealed.chunks++
    source.input.sealed = Promise.resolve(sealed)
    await expect(searchBodyParts(source.input, cached())).rejects.toThrow()
    expect(cache.append).toHaveBeenCalledTimes(3)
    expect(cache.commit).not.toHaveBeenCalled()
  }
)

it('rejects a native sealing failure and closes staged cache without publication', async () => {
  const source = transport()
  source.input.sealed = Promise.reject(new Error('public seal failure'))
  void source.input.sealed.catch(() => {})
  await expect(searchBodyParts(source.input, cached())).rejects.toThrow('public seal failure')
  expect(cache.commit).not.toHaveBeenCalled()
  expect(cache.close).toHaveBeenCalledOnce()
})

it('observes a sealing rejection during record staging without an unhandled rejection', async () => {
  const source = transport()
  let rejectSeal!: (error: Error) => void
  source.input.sealed = new Promise((_resolve, reject) => {
    rejectSeal = reject
  })
  cache.append.mockImplementationOnce(async () => {
    rejectSeal(new Error('public seal failed during staging'))
    // Cross an event-loop turn while the record stage is still pending. Only
    // the production consumer observes the seal; the test adds no catch to it.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await expect(searchBodyParts(source.input, cached())).rejects.toThrow('public seal failed during staging')
  expect(cache.append).toHaveBeenCalled()
  expect(cache.commit).not.toHaveBeenCalled()
  expect(cache.close).toHaveBeenCalledOnce()
})

it.each([0, -1, NaN, Infinity, 0.5])('rejects invalid runtime read budget %s', async (maximumReadBytes) => {
  const source = transport()
  source.input.maximumReadBytes = maximumReadBytes
  await expect(searchBodyParts(source.input, cached())).rejects.toThrow()
  expect(source.fetchMock).not.toHaveBeenCalled()
  expect(cache.commit).not.toHaveBeenCalled()
})

it('accounts for the entire concatenation before fetching a part that exceeds the exact runtime budget', async () => {
  const source = transport()
  source.input.maximumReadBytes--
  await expect(searchBodyParts(source.input, cached())).rejects.toThrow()
  expect(source.fetchMock).toHaveBeenCalledTimes(3)
  expect(cache.commit).not.toHaveBeenCalled()
})

it('rejects pre-cancelled input before any fetch or cache publication', async () => {
  const source = transport(),
    controller = new AbortController()
  controller.abort()
  await expect(searchBodyParts(source.input, { ...cached(), signal: controller.signal })).rejects.toThrow(
    '取消'
  )
  expect(source.fetchMock).not.toHaveBeenCalled()
  expect(cache.commit).not.toHaveBeenCalled()
})

it('cancellation after staging the first records part prevents reading the next part and publishing', async () => {
  const source = transport(),
    controller = new AbortController()
  source.input.parts = (async function* () {
    yield source.descriptors[0]!
    yield source.descriptors[1]!
    expect(cache.append).toHaveBeenCalledOnce()
    controller.abort()
    yield source.descriptors[2]!
    yield source.descriptors[3]!
  })()
  await expect(searchBodyParts(source.input, { ...cached(), signal: controller.signal })).rejects.toThrow(
    '取消'
  )
  expect(source.fetchMock).toHaveBeenCalledTimes(2)
  expect(cache.commit).not.toHaveBeenCalled()
  expect(cache.close).toHaveBeenCalledOnce()
})

it('cancellation while waiting for the final seal still prevents successful results and cache publication', async () => {
  const source = transport(),
    controller = new AbortController()
  let seal!: (value: typeof source.finalProof) => void
  source.input.sealed = new Promise((resolve) => {
    seal = resolve
  })
  const pending = searchBodyParts(source.input, { ...cached(), signal: controller.signal })
  const rejected = expect(pending).rejects.toThrow('取消')
  await vi.waitFor(() => expect(source.fetchMock).toHaveBeenCalledTimes(4))
  controller.abort()
  try {
    // Cancellation must settle the search even if native never sends a seal.
    await rejected
    expect(cache.commit).not.toHaveBeenCalled()
  } finally {
    seal(source.finalProof)
  }
})

const invalidLateRecords: Array<[string, (snapshot: ProjectedSnapshot) => void]> = [
  [
    'record schema',
    (value) => {
      value.records[1]!.name = 7
    }
  ],
  [
    'record module reference',
    (value) => {
      value.records[1]!.moduleId = 'missing-module'
    }
  ],
  [
    'duplicate record across parts',
    (value) => {
      value.records[1]!.id = 'r1'
    }
  ],
  [
    'log schema',
    (value) => {
      ;(value.records[1]!.rawContent as Record<string, unknown>).parserVersion = null
    }
  ],
  [
    'mismatched body source',
    (value) => {
      ;(value.records[1]!.rawContent as Record<string, unknown>).sourceUrl =
        'https://example.invalid/other-source'
    }
  ],
  [
    'invalid tuple flag',
    (value) => {
      ;(value.records[1]!.rawContent as { messages: unknown[][] }).messages[0]![4] = 'false'
    }
  ],
  [
    'short tuple',
    (value) => {
      ;(value.records[1]!.rawContent as { messages: unknown[][] }).messages[0]!.pop()
    }
  ],
  [
    'long tuple',
    (value) => {
      ;(value.records[1]!.rawContent as { messages: unknown[][] }).messages[0]!.push('extra')
    }
  ],
  [
    'non-string text',
    (value) => {
      ;(value.records[1]!.rawContent as { messages: unknown[][] }).messages[0]![3] = null
    }
  ]
]
it.each(invalidLateRecords)(
  'late %s failure never publishes previously staged hits or cache',
  async (_name, mutate) => {
    const snapshot = project(fixture())
    mutate(snapshot)
    await expect(searchBodyParts(transport(wire(snapshot)).input, cached())).rejects.toThrow()
    expect(cache.append).toHaveBeenCalled()
    expect(cache.commit).not.toHaveBeenCalled()
    expect(cache.close).toHaveBeenCalledOnce()
  }
)

const invalidGraphs: Array<[string, (snapshot: ProjectedSnapshot) => void]> = [
  [
    'duplicate module IDs',
    (value) => {
      value.modules.push(structuredClone(value.modules[0]!))
    }
  ],
  [
    'duplicate character IDs',
    (value) => {
      value.characters.push(structuredClone(value.characters[0]!))
    }
  ],
  [
    'character primary module reference',
    (value) => {
      value.characters[0]!.moduleId = 'missing-module'
    }
  ],
  [
    'character additional module reference',
    (value) => {
      value.characters[0]!.moduleIds.push('missing-module')
    }
  ],
  [
    'module pair character reference',
    (value) => {
      value.modules[0]!.pairs[0]!.characterId = 'missing-character'
    }
  ]
]
it.each(invalidGraphs)('retains complete root graph validation for %s', async (_name, mutate) => {
  const snapshot = project(fixture())
  mutate(snapshot)
  await expect(searchBodyParts(transport(wire(snapshot)).input, cached())).rejects.toThrow()
  expect(cache.commit).not.toHaveBeenCalled()
})

it.each([
  ['missing requested record', ['r1', 'r2', 'r3', 'not-present']],
  ['unexpected source record', ['r1', 'r2']],
  ['duplicate requested IDs', ['r1', 'r2', 'r3', 'r3']]
] as const)('retains exact selection checks for %s', async (_name, ids) => {
  await expect(searchBodyParts(transport().input, { ...cached(), ids: [...ids] })).rejects.toThrow()
  expect(cache.commit).not.toHaveBeenCalled()
})
