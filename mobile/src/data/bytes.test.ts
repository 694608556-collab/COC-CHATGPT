import { afterEach, expect, it, vi } from 'vitest'
import { encodeBase64, decodeBase64, encodeUtf8 } from './bytes'

afterEach(() => vi.unstubAllGlobals())

it('后台 UTF-8 编码保留换行、BOM、空字符及孤立代理项的标准语义', async () => {
  for (const text of ['', 'ASCII\r\n中文😀\0\ufeff', '\ud800x\udc00', '中文😀'.repeat(100000)]) {
    const expected = new TextEncoder().encode(text)
    let received: Blob | undefined
    vi.stubGlobal(
      'FileReaderSync',
      class {
        /** @param blob - 完整原文 Blob。 @returns 独立标准编码的字节。 */
        readAsArrayBuffer(blob: Blob) {
          received = blob
          return expected.buffer
        }
      }
    )
    expect(Buffer.from(encodeUtf8(text)).equals(Buffer.from(expected))).toBe(true)
    expect(received).toBeInstanceOf(Blob)
    expect(Buffer.from(await received!.arrayBuffer()).equals(Buffer.from(expected))).toBe(true)
    vi.stubGlobal('FileReaderSync', undefined)
    expect(Buffer.from(encodeUtf8(text)).equals(Buffer.from(expected))).toBe(true)
  }
})

it('后台 UTF-8 读取异常拒绝，不用空白字节代替正文', () => {
  vi.stubGlobal(
    'FileReaderSync',
    class {
      /** @param _blob - 公开原文。 @returns 不返回，模拟系统读取失败。 */
      readAsArrayBuffer(_blob: Blob): ArrayBuffer {
        throw new Error('公开字节读取失败')
      }
    }
  )
  expect(() => encodeUtf8('公开正文')).toThrow('公开字节读取失败')
})

it('后台编码使用原生读取器并只包含传入视图的字节', async () => {
  const backing = Uint8Array.from([99, 0, 1, 127, 128, 255, 88])
  const bytes = backing.subarray(1, 6)
  const expected = Buffer.from(bytes).toString('base64')
  let received: Blob | undefined
  vi.stubGlobal(
    'FileReaderSync',
    class {
      /** @param blob - 生产编码器创建的字节 Blob。 @returns 预先独立生成的 Base64 URL。 */
      readAsDataURL(blob: Blob) {
        received = blob
        return 'data:application/octet-stream;base64,' + expected
      }
    }
  )
  expect(encodeBase64(bytes)).toBe(expected)
  expect(received).toBeInstanceOf(Blob)
  expect(new Uint8Array(await received!.arrayBuffer())).toEqual(bytes)
  expect(backing).toEqual(Uint8Array.from([99, 0, 1, 127, 128, 255, 88]))
})

it('缺少后台读取器时完整编码空值、尾组及256KiB分段', () => {
  vi.stubGlobal('FileReaderSync', undefined)
  for (const size of [0, 1, 2, 3, 16383, 16384, 16385, 262144]) {
    const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 31) & 255)
    const encoded = encodeBase64(bytes)
    expect(encoded).toBe(Buffer.from(bytes).toString('base64'))
    expect(decodeBase64(encoded)).toEqual(bytes)
  }
})

it('后台读取失败或不合法的返回不能形成部分上传', () => {
  vi.stubGlobal(
    'FileReaderSync',
    class {
      /** @param _blob - 测试字节。 @returns 不合法结果，用于验证拒绝。 */
      readAsDataURL(_blob: Blob) {
        return 'data:text/plain;base64,AA=='
      }
    }
  )
  expect(() => encodeBase64(new Uint8Array([0]))).toThrow('编码')
  vi.stubGlobal(
    'FileReaderSync',
    class {
      /** @param _blob - 测试字节。 @returns 不返回，注入读取错误。 */
      readAsDataURL(_blob: Blob): string {
        throw new Error('公开读取失败')
      }
    }
  )
  expect(() => encodeBase64(new Uint8Array([0]))).toThrow('公开读取失败')
})
