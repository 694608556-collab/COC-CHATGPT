import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'
import { performTableStreamJob } from './table-stream-job'
import type { TableStreamJob } from './table-stream-job'
import { publicCoc7Workbook } from '../../test-fixtures/coc7'
import { StreamSha256 } from './stream-sha256'

afterEach(() => vi.unstubAllGlobals())

/** Build a public multi-chunk workbook and its complete native token transport.
 * @param measure Whether optional numeric diagnostics are requested.
 * @param body Complete public manual text, including any Unicode edge cases.
 * @returns The same source, complete manual body and records job in either mode.
 */
function fixture(measure: boolean, body = '公开正文😀\r\n'.repeat(25000) + '完整尾部') {
  const parts = body.match(/[\s\S]{1,30000}/g)!
  const rows = [
    [
      '模组名',
      '场次名',
      '海豹链接',
      ...parts.map((_, index) => (index ? `手动保存内容（续${index}）` : '手动保存内容'))
    ],
    ['公开模组', '完整手动场次', '', ...parts],
    ['公开模组', '完整链接场次', 'https://log.weizaima.com/?key=public-measure', ...parts.map(() => '')]
  ]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '公开工作表')
  const bytes = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))
  const source = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  const payload = {
    version: 1,
    supported: true,
    projection: 'records',
    compact: true,
    stringCount: 0,
    strings: {},
    validatedCells: rows.flat().length,
    sheets: [
      {
        name: '公开工作表',
        order: 0,
        mergedRanges: [],
        rows: rows.map((values, index) => ({
          index,
          cells: values.map((value, column) => [
            XLSX.utils.encode_cell({ r: index, c: column }),
            'inlineStr',
            '',
            value,
            '',
            false
          ])
        }))
      }
    ]
  }
  const job: TableStreamJob = {
    source: { ...source, url: 'https://localhost/_capacitor_file_/public.xlsx' },
    name: 'public.xlsx',
    format: 'xlsx',
    kind: 'records',
    maximumStageBytes: Number.MAX_SAFE_INTEGER,
    measure,
    recordsKernel: { source, payloadJson: JSON.stringify(payload) }
  }
  return { body, job }
}

/** Run the real candidate path with an acknowledged private test sink.
 * @param measure Whether numeric diagnostics are enabled.
 * @param text Optional complete public manual body.
 * @returns Complete staged bytes, proof and optional timings.
 */
async function complete(measure: boolean, text?: string) {
  const { job, body } = fixture(measure, text),
    chunks: Uint8Array[] = []
  const result = await performTableStreamJob(
    job,
    async (key, bytes) => {
      expect(key).toBe('candidate')
      chunks.push(bytes.slice())
      await Promise.resolve()
    },
    async () => {
      throw new Error('Unexpected public SST read')
    }
  )
  return { body, bytes: Buffer.concat(chunks), result }
}

it('records calculate the complete candidate proof while each private append awaits acknowledgement', async () => {
  const { job } = fixture(true), events: string[] = [], chunks: Uint8Array[] = []
  const original = StreamSha256.prototype.update
  const update = vi.spyOn(StreamSha256.prototype, 'update').mockImplementation(function (this: StreamSha256, bytes) {
    events.push('digest')
    return original.call(this, bytes)
  })
  try {
    const result = await performTableStreamJob(job, async (key, bytes) => {
      expect(key).toBe('candidate')
      chunks.push(bytes.slice())
      events.push('write')
      await Promise.resolve()
      events.push('ack')
    }, async () => { throw Error('Unexpected SST') })
    expect(chunks.length).toBeGreaterThan(1)
    expect(events).toEqual(chunks.flatMap(() => ['write', 'digest', 'ack']))
    const bytes = Buffer.concat(chunks)
    expect(result.candidate).toEqual({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  } finally { update.mockRestore() }
})

it('optional records timings preserve every candidate byte and SHA across multiple acknowledged chunks', async () => {
  const plain = await complete(false),
    measured = await complete(true)
  expect(measured.bytes.length).toBeGreaterThan(262144)
  expect(measured.bytes).toEqual(plain.bytes)
  expect(measured.result.candidate).toEqual(plain.result.candidate)
  expect(measured.result.candidate).toEqual({
    bytes: measured.bytes.length,
    sha256: createHash('sha256').update(measured.bytes).digest('hex')
  })
  expect(JSON.parse(measured.bytes.toString('utf8').split('\n')[0]!.slice(1)).value.manualContent).toBe(
    measured.body
  )
  expect(plain.result.timing).toBeUndefined()
  const timing = measured.result.timing!
  expect(Object.keys(timing)).toEqual(
    expect.arrayContaining([
      'jsCandidateJsonMs',
      'jsCandidateUtf8Ms',
      'jsDigestUpdateMs',
      'jsAwaitWriteMs',
      'jsRecordsReplayMs',
      'jsTotalMs'
    ])
  )
  expect(Object.values(timing).every((value) => Number.isFinite(value) && value >= 0)).toBe(true)
  expect(timing.jsTotalMs).toBeGreaterThanOrEqual(timing.jsRecordsReplayMs!)
})

it.each([false, true])('digest failure still settles the outstanding append and preserves its failure priority: %s', async (rejectAppend) => {
  const { job } = fixture(true)
  let release!: () => void, entered!: () => void
  const acknowledgement = new Promise<void>(resolve => { release = resolve })
  const writing = new Promise<void>(resolve => { entered = resolve })
  const update = vi.spyOn(StreamSha256.prototype, 'update').mockImplementation(() => { throw Error('candidate digest failed') })
  try {
    const result = performTableStreamJob(job, async () => {
      entered()
      await acknowledgement
      if (rejectAppend) throw Error('private append failed')
    }, async () => { throw Error('Unexpected SST') })
    let settled = false
    void result.then(() => { settled = true }, () => { settled = true })
    await writing
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await expect(result).rejects.toThrow(rejectAppend ? 'private append failed' : 'candidate digest failed')
  } finally { update.mockRestore() }
})

it.each([16383, 16384])(
  'candidate encoding changes implementation only at the internal %s-code-unit boundary',
  async (length) => {
    const reference = await complete(false, 'x')
    const overhead = reference.bytes.toString('utf8').split('\n')[0]!.length
    const body = 'x'.repeat(length - overhead)
    const baseline = await complete(false, body)
    const firstLine = baseline.bytes.toString('utf8').split('\n')[0]! + '\n'
    expect(firstLine.length).toBe(length)
    const expected = new TextEncoder().encode(firstLine),
      received: Blob[] = []
    vi.stubGlobal(
      'FileReaderSync',
      class {
        /** @param blob Complete candidate line. @returns Independently encoded public bytes. */
        readAsArrayBuffer(blob: Blob) {
          received.push(blob)
          return expected.buffer
        }
      }
    )
    const actual = await complete(false, body)
    expect(actual.bytes).toEqual(baseline.bytes)
    expect(actual.result.candidate).toEqual(baseline.result.candidate)
    expect(received).toHaveLength(length >= 16384 ? 1 : 0)
    for (const blob of received) expect(new Uint8Array(await blob.arrayBuffer())).toEqual(expected)
  }
)

it('large Worker Blob candidates preserve full multi-chunk Unicode, lone surrogates, CRLF, NUL and SHA', async () => {
  const body = '公开正文😀\r\n'.repeat(25000) + '\0\ufeff\ud800x\udc00\r\n完整尾部'
  const baseline = await complete(true, body)
  const firstLine = baseline.bytes.toString('utf8').split('\n')[0]! + '\n'
  const expected = new TextEncoder().encode(firstLine),
    received: Blob[] = []
  vi.stubGlobal(
    'FileReaderSync',
    class {
      /** @param blob Complete original candidate line. @returns Independent standard UTF-8 bytes. */
      readAsArrayBuffer(blob: Blob) {
        received.push(blob)
        return expected.buffer
      }
    }
  )
  const actual = await complete(true, body)
  expect(actual.bytes.length).toBeGreaterThan(262144)
  expect(actual.bytes).toEqual(baseline.bytes)
  expect(actual.result.candidate).toEqual(baseline.result.candidate)
  expect(JSON.parse(actual.bytes.toString('utf8').split('\n')[0]!.slice(1)).value.manualContent).toBe(body)
  expect(received).toHaveLength(1)
  expect(new Uint8Array(await received[0]!.arrayBuffer())).toEqual(expected)
})

it('a failed large candidate Blob read rejects before staging and never falls back to empty or substitute bytes', async () => {
  const { job } = fixture(true)
  vi.stubGlobal(
    'FileReaderSync',
    class {
      /** @param _blob Complete public candidate. @returns Never returns; simulates native reader failure. */
      readAsArrayBuffer(_blob: Blob): ArrayBuffer {
        throw new Error('public candidate Blob read failed')
      }
    }
  )
  let writes = 0
  await expect(
    performTableStreamJob(
      job,
      async () => {
        writes++
      },
      async () => {
        throw new Error('Unexpected SST read')
      }
    )
  ).rejects.toThrow('public candidate Blob read failed')
  expect(writes).toBe(0)
})

it.each([false, true])(
  'measure=%s still rejects a native append failure without producing a successful proof',
  async (measure) => {
    const { job } = fixture(measure)
    await expect(
      performTableStreamJob(
        job,
        async () => {
          throw new Error('public append rejected')
        },
        async () => {
          throw new Error('Unexpected SST read')
        }
      )
    ).rejects.toThrow('public append rejected')
  }
)

it.each(['characters', 'coc7'] as const)(
  'measured %s keeps its existing result contract even when complete SST strings spill',
  async (kind) => {
    const workbook = publicCoc7Workbook()
    const extraRows = Array.from({ length: 50 }, (_, index) => [String(index) + '公开扩展字段'.repeat(4000)])
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(extraRows), '公开完整SST')
    const bytes = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx', bookSST: true }))
    vi.stubGlobal('location', new URL('https://localhost/'))
    vi.stubGlobal('fetch', async () => new Response(bytes.slice().buffer))
    const strings = new Map<number, string>(),
      decoder = new TextDecoder(),
      staged: string[] = []
    let pending = ''
    const result = await performTableStreamJob(
      {
        source: {
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          url: 'https://localhost/_capacitor_file_/public.xlsx'
        },
        name: 'public.xlsx',
        format: 'xlsx',
        kind,
        maximumStageBytes: Number.MAX_SAFE_INTEGER,
        measure: true
      },
      async (key, chunk) => {
        staged.push(key)
        if (key !== 'strings') return
        pending += decoder.decode(chunk, { stream: true })
        let newline: number
        while ((newline = pending.indexOf('\n')) >= 0) {
          const [index, value] = JSON.parse(pending.slice(0, newline)) as [number, string]
          strings.set(index, value)
          pending = pending.slice(newline + 1)
        }
      },
      async (index) => {
        const value = strings.get(index)
        if (value === undefined) throw new Error('Missing complete public spilled string')
        return value
      }
    )
    expect(staged).toContain('strings')
    if (kind === 'characters') {
      expect(result.candidate).toBeDefined()
      expect(result.timing).toBeUndefined()
      expect(Object.keys(result).sort()).toEqual(['candidate', 'candidates'])
    } else {
      expect(result.draft).toBeDefined()
      expect(Object.keys(result).sort()).toEqual(['draft', 'timing'])
      expect(result.timing?.total).toBeGreaterThanOrEqual(0)
      expect(Object.keys(result.timing!).some((key) => key.startsWith('js'))).toBe(false)
    }
  }
)

it.each([false, true])(
  'measure=%s still rejects cancellation after the append acknowledgement',
  async (measure) => {
    const { job } = fixture(measure),
      controller = new AbortController()
    await expect(
      performTableStreamJob(
        job,
        async () => {
          controller.abort()
        },
        async () => {
          throw new Error('Unexpected SST read')
        },
        controller.signal
      )
    ).rejects.toThrow('取消')
  }
)

it.each([false, true])(
  'measure=%s still rejects a changed complete-source proof before any append',
  async (measure) => {
    const { job } = fixture(measure)
    job.source.sha256 = '0'.repeat(64)
    let writes = 0
    await expect(
      performTableStreamJob(
        job,
        async () => {
          writes++
        },
        async () => {
          throw new Error('Unexpected SST read')
        }
      )
    ).rejects.toThrow('来源完整证明')
    expect(writes).toBe(0)
  }
)
