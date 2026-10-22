import { expect, it, vi } from 'vitest'
import { StreamJson, utf8Size } from './stream-json'

it('UTF-8长度计量不反复分配编码数组，孤立代理项和换行仍按标准计量', () => {
  const values = ['公开😀\r\n正文', '\ud800', '\udc00', 'a\ud800b', 'plain', '']
  const expected = values.map((text) => new TextEncoder().encode(text).length)
  const encode = vi.spyOn(TextEncoder.prototype, 'encode')
  try {
    expect(values.map(utf8Size)).toEqual(expected)
    expect(encode).not.toHaveBeenCalled()
  } finally {
    encode.mockRestore()
  }
})

it('长正文字符串按引号和转义边界扫描，完整保留内容而不逐字跨入JS扫描器', async () => {
  const value = { body: '公开完整正文😀'.repeat(40000), tail: '终点\\"' }
  const text = JSON.stringify(value)
  const bytes = new TextEncoder().encode(text)
  async function* source() {
    for (let at = 0; at < bytes.length; at += 65536) yield bytes.subarray(at, at + 65536)
  }
  const reads = vi.spyOn(String.prototype, 'charCodeAt')
  try {
    const cursor = new StreamJson(source(), bytes.length, bytes.length)
    expect((await cursor.readRawValue()).value).toEqual(value)
    expect((await cursor.finish()).bytes).toBe(bytes.length)
    expect(reads.mock.calls.length).toBeLessThan(1000)
  } finally {
    reads.mockRestore()
  }
})
