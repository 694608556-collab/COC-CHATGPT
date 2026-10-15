import { expect, it } from 'vitest'
import { decodeBase64 } from './native'

it('大文件解码及时完成且不遗漏字节', () => {
  const base64 = 'AAAA'.repeat(4 * 1024 * 1024)
  const started = performance.now()
  const bytes = decodeBase64(base64)
  expect(performance.now() - started).toBeLessThan(150)
  expect(bytes.length).toBe(12 * 1024 * 1024)
  expect(bytes[0]).toBe(0)
  expect(bytes[bytes.length - 1]).toBe(0)
})
