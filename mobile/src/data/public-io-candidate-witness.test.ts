import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { CandidateWitness } from '../../tests/public-io-candidate-witness'

afterEach(() => vi.restoreAllMocks())

it('capture retains every immutable bridge segment without decoding inside measured production work', () => {
  const bytes = Buffer.from('完整公开正文😀\r\n\0尾'.repeat(24000)),
    original = globalThis.atob
  const decode = vi.spyOn(globalThis, 'atob').mockImplementation((value) => original(value))
  const witness = new CandidateWitness()
  for (let at = 0; at < bytes.length; at += 262144)
    witness.append(bytes.subarray(at, at + 262144).toString('base64'))
  expect(decode).not.toHaveBeenCalled()
  const complete = witness.read()
  expect(Buffer.from(complete)).toEqual(bytes)
  expect(createHash('sha256').update(complete).digest('hex')).toBe(
    createHash('sha256').update(bytes).digest('hex')
  )
  expect(decode).toHaveBeenCalledTimes(Math.ceil(bytes.length / 262144))
  expect(() => witness.read()).toThrow()
  expect(() => witness.append('AA==')).toThrow()
})

it('corrupt evidence fails its full independent readback and cannot become a successful witness', () => {
  const witness = new CandidateWitness()
  witness.append('%%%invalid%%%')
  expect(() => witness.read()).toThrow()
  expect(() => witness.read()).toThrow()
})
