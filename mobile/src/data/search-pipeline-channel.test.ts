import { expect, it } from 'vitest'
import { createSearchPipelineChannel } from './search-pipeline-channel'

const part = {
  index: 0,
  kind: 'root' as const,
  source: { url: 'https://localhost/_capacitor_file_/public', bytes: 4, sha256: 'a'.repeat(64) }
}
it('waits for ordered credentials and a final full-source seal without prematurely finishing', async () => {
  const channel = createSearchPipelineChannel('operation', 100)
  const iterator = channel.input.parts[Symbol.asyncIterator]()
  const pending = iterator.next()
  channel.push({ type: 'search-part', nonce: 'operation', part })
  expect(await pending).toEqual({ done: false, value: part })
  const last = iterator.next(),
    proof = { bytes: 4, sha256: 'a'.repeat(64), chunks: 1 }
  channel.push({ type: 'search-seal', nonce: 'operation', proof })
  expect(await last).toEqual({ done: true, value: undefined })
  expect(await channel.input.sealed).toEqual(proof)
  channel.close()
})
it('cancellation, a foreign operation, post-seal pieces and exhausted runtime budgets poison the entire pending reader', async () => {
  for (const bad of ['cancel', 'foreign', 'late', 'budget']) {
    const controller = new AbortController(),
      channel = createSearchPipelineChannel('operation', 3, controller.signal)
    const iterator = channel.input.parts[Symbol.asyncIterator]()
    const pending = iterator.next()
    const rejection = expect(pending).rejects.toThrow()
    if (bad === 'cancel') controller.abort()
    else if (bad === 'late') {
      channel.push({
        type: 'search-seal',
        nonce: 'operation',
        proof: { bytes: 0, sha256: 'a'.repeat(64), chunks: 0 }
      })
      channel.push({ type: 'search-part', nonce: 'operation', part })
    } else channel.push({ type: 'search-part', nonce: bad === 'foreign' ? 'wrong' : 'operation', part })
    await rejection
    if (bad !== 'late') await expect(channel.input.sealed).rejects.toThrow()
    channel.close()
  }
})
