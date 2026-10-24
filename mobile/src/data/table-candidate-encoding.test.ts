import { afterEach, expect, it, vi } from 'vitest'
import { encodeTableCandidate } from './table-candidate-encoding'

afterEach(() => vi.unstubAllGlobals())

it('ordinary queued candidate windows never enter the cold synchronous file service', () => {
  vi.stubGlobal(
    'FileReaderSync',
    class {
      readAsArrayBuffer() {
        throw new Error('Cold file service must not be needed for queued metadata')
      }
    }
  )
  for (const text of [
    '中文😀\r\n\0\ud800'.repeat(4096),
    'A'.repeat(256 * 1024),
    'B'.repeat(1024 * 1024 - 1)
  ]) {
    expect(Buffer.from(encodeTableCandidate(text)).equals(Buffer.from(new TextEncoder().encode(text)))).toBe(
      true
    )
  }
})

it('larger complete candidate segments retain every byte through the existing file encoder', async () => {
  const text = '中文😀\r\n'.repeat(200000)
  const expected = new TextEncoder().encode(text)
  let seen: Blob | undefined
  vi.stubGlobal(
    'FileReaderSync',
    class {
      readAsArrayBuffer(blob: Blob) {
        seen = blob
        return expected.buffer
      }
    }
  )
  expect(Buffer.from(encodeTableCandidate(text)).equals(Buffer.from(expected))).toBe(true)
  expect(Buffer.from(await seen!.arrayBuffer()).equals(Buffer.from(expected))).toBe(true)
})
