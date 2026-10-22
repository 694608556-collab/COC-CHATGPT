import { expect, it } from 'vitest'
import { addStreamBytes, checkStreamBudget } from './stream-json'
import { StreamSha256 } from './stream-sha256'

it('resource accounting accepts values beyond old quotas but rejects imprecise arithmetic', () => {
  expect(addStreamBytes(64 * 1024 * 1024, 1)).toBe(67108865)
  expect(addStreamBytes(Number.MAX_SAFE_INTEGER - 1, 1)).toBe(Number.MAX_SAFE_INTEGER)
  for (const value of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => addStreamBytes(0, value)).toThrow('计量')
    expect(() => checkStreamBudget(value)).toThrow('预算')
  }
  expect(() => addStreamBytes(Number.MAX_SAFE_INTEGER, 1)).toThrow('计量')
  const digest = new StreamSha256()
  ;(digest as unknown as { length: number }).length = Number.MAX_SAFE_INTEGER
  expect(() => digest.update(new Uint8Array([1]))).toThrow('字节数')
})
