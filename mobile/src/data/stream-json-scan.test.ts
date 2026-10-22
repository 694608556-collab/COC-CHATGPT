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

it('来源已按字节限制时不重复编码计量每个词元，更小的独立值预算仍严格生效', async () => {
  const text = JSON.stringify({ body: '公开正文😀'.repeat(1000) })
  const bytes = new TextEncoder().encode(text)
  async function* source() {
    yield bytes
  }
  const replace = vi.spyOn(String.prototype, 'replace')
  try {
    const reader = new StreamJson(source(), bytes.length, bytes.length)
    expect((await reader.readRawValue()).json).toBe(text)
    expect((await reader.finish()).bytes).toBe(bytes.length)
    expect(replace).not.toHaveBeenCalled()
  } finally {
    replace.mockRestore()
  }
  await expect(new StreamJson(source(), bytes.length, 100).readRawValue()).rejects.toThrow('超过')
  await expect(new StreamJson(source(), bytes.length - 1, bytes.length - 1).readRawValue()).rejects.toThrow(
    '超过'
  )
})

it('常见同段对象键直接取原始区间，不为每个键分配分段收集器', async () => {
  const text = JSON.stringify(Array.from({ length: 1000 }, (_, id) => ({ id, text: '公开正文', images: [] })))
  const bytes = new TextEncoder().encode(text)
  async function* source() {
    yield bytes
  }
  const join = vi.spyOn(Array.prototype, 'join')
  let joins = 0
  try {
    const reader = new StreamJson(source(), bytes.length, bytes.length)
    await reader.readRawValue()
    await reader.finish()
    joins = join.mock.calls.length
  } finally {
    join.mockRestore()
  }
  expect(joins).toBeLessThan(30)
})
