import { expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import { completeResponseWitness } from '../../tests/private-search-proof'

it('full raw evidence accepts the actual compressed Sea protocol without losing fields, order or Unicode tails', () => {
  const rows = [{ id: 'first', content: '完整😀开头', extra: { exact: ['a', 3, false] } },
    { id: 'last', content: '终尾'.repeat(12000), unknown: { keep: true } }]
  const payload = { title: '公开原始响应', messages: rows }
  const wire = { status: true, data: deflateSync(Buffer.from(JSON.stringify(payload))).toString('base64') }
  const witness = completeResponseWitness(JSON.stringify(wire))
  expect(witness.rows).toEqual(rows)
  expect(witness.payload).toEqual({ ...wire, ...payload })
  expect(completeResponseWitness(JSON.stringify(payload)).rows).toEqual(rows)
  expect(() => completeResponseWitness('{"data":"%%%"}')).toThrow()
})
