import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { Capacitor } from '@capacitor/core'
import * as XLSX from 'xlsx'
import { previewNativeTable, previewNativeCoc7 } from './table-stream-client'
import type { TableStreamPort, NativeTableSource } from './table-stream-native'
import { decodeBase64, encodeBase64 } from './bytes'
import { publicCoc7Workbook } from '../../test-fixtures/coc7'
import { StreamSha256 } from './stream-sha256'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Measures real parser/client native requests with a deterministic bridge-latency model.
 * @param bytes Fictional complete XLSX input. @returns Native adapter and measured requests; no production writes.
 */
function measuredPreview(bytes: Uint8Array) {
  vi.stubGlobal('location', new URL('https://localhost/'))
  vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios')
  const counters = { nativeReads: 0, nativeWrites: 0, localRequests: 0 }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options) => {
      counters.localRequests++
      const range = new Headers(options?.headers).get('Range')
      const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '')
      if (!match) throw new Error('Expected bounded iOS source request')
      const start = Number(match[1]),
        end = Number(match[2])
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: {
          'content-range': `bytes ${start}-${end}/${bytes.length}`,
          'content-length': String(end - start + 1)
        }
      })
    })
  )
  const strings = new Map<number, Uint8Array>(),
    candidate: Uint8Array[] = []
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let pending = ''
  const port: Required<TableStreamPort> = {
    appendTableStage: vi.fn(async ({ key, base64 }) => {
      counters.nativeWrites++
      const value = decodeBase64(base64)
      if (key === 'candidate') {
        candidate.push(value)
        return
      }
      pending += decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        const [index, text] = JSON.parse(pending.slice(0, newline)) as [number, string]
        strings.set(index, new TextEncoder().encode(text))
        pending = pending.slice(newline + 1)
      }
    }),
    readTableString: vi.fn(async ({ stringIndex, offset }) => {
      counters.nativeReads++
      const value = strings.get(stringIndex)
      if (!value) throw new Error('Private string missing')
      const part = value.subarray(offset, offset + 262144)
      return { bytes: value.length, base64: encodeBase64(part), done: offset + part.length === value.length }
    }),
    finishTablePreview: vi.fn(async ({ id, candidate: proof }) => {
      const content = Buffer.concat(candidate)
      expect(proof).toEqual({
        bytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex')
      })
      return {
        id,
        revision: 1,
        added: 114,
        updated: 0,
        skipped: 0,
        namesCount: 114,
        warningsCount: 0,
        names: [],
        warnings: []
      }
    }),
    readTablePreview: vi.fn(async () => ({ values: [], total: 0 })),
    commitTableStream: vi.fn(async () => {
      throw new Error('Preview must not commit')
    }),
    cancelTableStage: vi.fn(async () => {})
  }
  const source: NativeTableSource = {
    id: 'public-latency',
    revision: 1,
    fileUri: 'https://localhost/_capacitor_file_/public.xlsx',
    name: 'public.xlsx',
    format: 'xlsx',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    maximumStageBytes: 1024 * 1024 * 1024
  }
  return { port, source, counters, candidate }
}

it.each([1, 114])('%i场小表预览不能因逐字符串串行原生往返累积等待', async (count) => {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['模组名', '场次名', '海豹链接'],
      ...Array.from({ length: count }, (_, i) => [
        '公开团',
        `公开场${i}`,
        `https://log.weizaima.com/?key=public${i}`
      ])
    ]),
    '场次'
  )
  const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', bookSST: true }))
  const { port, source, counters, candidate } = measuredPreview(bytes),
    start = performance.now()
  await previewNativeTable(port, source, 'records')
  const records = Buffer.concat(candidate).toString('utf8').trimEnd().split('\n')
  expect(records).toHaveLength(count)
  expect(JSON.parse(records[count - 1]!.slice(1)).value.link).toBe(
    `https://log.weizaima.com/?key=public${count - 1}`
  )
  console.log(
    JSON.stringify({
      fixture: `public-${count}-links`,
      bytes: bytes.length,
      ...counters,
      parserHostMs: performance.now() - start,
      modeledSerialBridgeMs: (counters.nativeReads + counters.nativeWrites) * 10,
      phoneMeasurement: false
    })
  )
  expect(
    counters.nativeReads + counters.nativeWrites,
    'small preview must avoid hundreds of serial native round trips'
  ).toBeLessThanOrEqual(20)
  expect(port.commitTableStream).not.toHaveBeenCalled()
})

it('约700KB七版角色卡预览不能因工作簿目录和字符串原生往返累积等待', async () => {
  // Exercise the complete JS-SHA fallback even on a host with WebCrypto.
  // Native SHA byte coverage/failure/cancellation has independent proof tests.
  vi.stubGlobal('crypto', { randomUUID: globalThis.crypto.randomUUID.bind(globalThis.crypto) })
  const hashed = vi.spyOn(StreamSha256.prototype, 'update')
  const book = publicCoc7Workbook()
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet(
      Array.from({ length: 65 }, (_, i) => [`public-auxiliary-${i}-`.padEnd(10000, 'x')])
    ),
    '公开辅助说明'
  )
  const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', bookSST: true }))
  const { port, source, counters } = measuredPreview(bytes),
    start = performance.now()
  const draft = await previewNativeCoc7(port, source)
  expect(draft.character.basic.name).toBe('公开七版调查员')
  console.log(
    JSON.stringify({
      fixture: 'public-character-card',
      bytes: bytes.length,
      ...counters,
      parserHostMs: performance.now() - start,
      modeledSerialBridgeMs: (counters.nativeReads + counters.nativeWrites) * 10,
      phoneMeasurement: false
    })
  )
  expect(
    counters.nativeReads + counters.nativeWrites,
    'small card must avoid serial native directory/string requests'
  ).toBeLessThanOrEqual(20)
  expect(counters.nativeWrites, 'a complete resident character string index must not require native persistence').toBe(0)
  expect(hashed.mock.calls.reduce((sum, [chunk]) => sum + chunk.length, 0), 'immutable private XLSX bytes must be fully hashed once, not once for each ZIP pass').toBe(bytes.length)
  expect(port.commitTableStream).not.toHaveBeenCalled()
})

it('超过临时缓存预算的工作簿继续磁盘索引并完整保留末场，不形成新的文件配额', async () => {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['模组名', '场次名', '海豹链接'],
      ['公开团', '公开末场', 'https://log.weizaima.com/?key=public-last']
    ]),
    '场次'
  )
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet(
      Array.from({ length: 120 }, (_, index) => [`public-over-cache-${index}-`.padEnd(20000, 'x')])
    ),
    '公开辅助说明'
  )
  const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', bookSST: true }))
  expect(bytes.length).toBeGreaterThan(2 * 1024 * 1024)
  const { port, source, counters, candidate } = measuredPreview(bytes)
  await previewNativeTable(port, source, 'records')
  const records = Buffer.concat(candidate).toString('utf8').trimEnd().split('\n')
  expect(records).toHaveLength(1)
  expect(JSON.parse(records[0]!.slice(1)).value.link).toBe('https://log.weizaima.com/?key=public-last')
  expect(counters.nativeReads).toBeGreaterThan(0)
  expect(counters.localRequests).toBeGreaterThan(Math.ceil(bytes.length / 262144))
  expect(port.commitTableStream).not.toHaveBeenCalled()
})
