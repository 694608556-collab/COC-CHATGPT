import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { StreamJson } from './stream-json'

/** Runs the real cursor across arbitrary UTF-8 boundaries and verifies full input proof.
 * @param text Complete public JSON. @param size Maximum input chunk bytes.
 * @returns Parsed and original value after EOF validation.
 */
async function read(text: string, size: number) {
  const bytes = new TextEncoder().encode(text)
  async function* chunks() {
    for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size)
  }
  const cursor = new StreamJson(chunks(), bytes.length, bytes.length)
  const result = await cursor.readRawValue()
  expect(await cursor.finish()).toEqual({
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  })
  return result
}

it('分块容器保留原始正文词元、转义键和值，不截断超长字符串或原始大整数', async () => {
  const text =
    '{"中文😀":{"a\\\"\\\\":"' +
    '完整\"}][{😀'.repeat(6000).replace(/\\/g, '\\\\').replace(/"/g, '\\"') +
    '","large":900719925474099312345},"array":[true,null,-1.25e+3,{"a":1}],"end":"\\u0000\\ud800"}'
  for (const size of [1, 7, 65536]) {
    const result = await read(text, size)
    expect(result.value).toEqual(JSON.parse(text))
    expect(result.json).toBe(text)
  }
})

it.each([
  '{"a":1,"\\u0061":2}',
  '{"a":{"中文":1,"\\u4e2d文":2}}',
  '{"a":[{"x":1,"x":2}]}',
  '{"x":1,}',
  '[true,]',
  '{"a":01}',
  '{"a":"\\x41"}',
  '{"a":"\\u00xz"}',
  '{"a":"raw\nnewline"}',
  '{"x":[1}}',
  '{"x":false true}',
  '{"x":1} trailing',
  '[{"a":1}',
  '{"a",1}',
  '{"a":undefined}',
  '{"a":NaN}',
  '{"a":+1}',
  '['.repeat(257) + '0' + ']'.repeat(257),
  '{"x":'.repeat(129) + '0' + '}'.repeat(129)
])('快速容器扫描仍拒绝重复字段、损坏语法和过深嵌套：%s', async (text) => {
  for (const size of [1, 7, 65536]) await expect(read(text, size)).rejects.toThrow()
})

it('同步语法终检与JSON.parse在公开有效嵌套值上等价，跨段结束位置不吞掉下一字段', async () => {
  for (let i = 0; i < 50; i++) {
    const value = {
      [i % 2 ? '__proto__' : '公开😀']: [i, -i / 3, true, null, { key: '"\\},:' + i }],
      tail: i % 3 ? [] : {}
    }
    const text = JSON.stringify(value)
    expect((await read(text, (i % 11) + 1)).value).toEqual(JSON.parse(text))
  }
  await read('['.repeat(257) + ']'.repeat(257), 7)
  await read('{"x":'.repeat(128) + '0' + '}'.repeat(128), 7)
})
