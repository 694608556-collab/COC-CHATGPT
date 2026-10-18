import { afterEach, expect, it, vi } from 'vitest'
import { Capacitor } from '@capacitor/core'
import { saveGeneratedExport } from './export-archive'
import { decodeBase64 } from './bytes'
import type { LogbookPort } from './native'
afterEach(() => vi.restoreAllMocks())
it('iOS 大文件保留完整正文和备份用途，不调用未注册的 Android 暂存接口', async () => {
  vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios')
  const bytes = new TextEncoder().encode('中文😀'.repeat(200000))
  const writeArchive = vi.fn(async (options: { base64: string; purpose: string }) => {
    expect(Buffer.from(decodeBase64(options.base64)).equals(Buffer.from(bytes))).toBe(true)
    expect(options.purpose).toBe('backup')
    return { uri: 'test-only', name: 'public.json', bytes: bytes.length, sha256: 'test-only' }
  })
  const beginPdfArchive = vi.fn(async () => {
    throw new Error('iOS has no Android spool')
  })
  await saveGeneratedExport(
    { writeArchive, beginPdfArchive } as unknown as LogbookPort,
    { name: 'public.json', mime: 'application/json', bytes },
    'backup'
  )
  expect(writeArchive).toHaveBeenCalledOnce()
  expect(beginPdfArchive).not.toHaveBeenCalled()
})
it('Android 大文件仍有界分段，保持完整字节及既有发布/清理顺序', async () => {
  vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android')
  const bytes = new Uint8Array(1024 * 1024 + 17).fill(123),
    chunks: Uint8Array[] = [],
    order: string[] = []
  const port = {
    beginPdfArchive: async () => {
      order.push('begin')
      return { id: 'owned' }
    },
    appendPdfArchive: async (o: { id: string; base64: string }) => {
      expect(o.id).toBe('owned')
      const c = decodeBase64(o.base64)
      expect(c.length).toBeLessThanOrEqual(256 * 1024)
      chunks.push(c)
    },
    finishExportArchive: async (o: { id: string; purpose: string }) => {
      expect(o).toMatchObject({ id: 'owned', purpose: 'backup' })
      order.push('finish')
      return { uri: 'test-only', name: 'public.json', bytes: bytes.length, sha256: 'test-only' }
    },
    cancelPdfArchive: async () => {
      order.push('cleanup')
    }
  }
  await saveGeneratedExport(
    port as unknown as LogbookPort,
    { name: 'public.json', mime: 'application/json', bytes },
    'backup'
  )
  const combined = new Uint8Array(bytes.length)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.length
  }
  expect(Buffer.from(combined).equals(Buffer.from(bytes))).toBe(true)
  expect(order).toEqual(['begin', 'finish', 'cleanup'])
})
