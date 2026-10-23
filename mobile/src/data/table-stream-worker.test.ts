import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

afterEach(() => vi.unstubAllGlobals())

/** Exercise the actual Worker message and append acknowledgement boundary.
 * @param measure Whether the records job requests numeric diagnostics.
 * @param fail Whether the native test sink rejects its append.
 * @returns The final complete or failed Worker message and every staged byte.
 */
async function run(measure: boolean, fail = false) {
  const chunks: Buffer[] = []
  let finish!: (message: any) => void
  const finished = new Promise<any>((resolve) => {
    finish = resolve
  })
  const worker = {
    onmessage: undefined as ((event: any) => void) | undefined,
    postMessage(message: any) {
      if (message.type === 'done' || message.type === 'failed') {
        finish(message)
        return
      }
      if (message.type !== 'chunk') throw Error('Unexpected worker request')
      chunks.push(Buffer.from(message.base64, 'base64'))
      queueMicrotask(() =>
        worker.onmessage!({
          data: {
            type: 'reply',
            request: message.request,
            ...(fail ? { error: 'native append refused' } : { result: {} })
          }
        })
      )
    }
  }
  vi.stubGlobal('self', worker)
  vi.resetModules()
  await import('./table-stream-worker')
  const source = { bytes: 1, sha256: 'a'.repeat(64) }
  const values = [
    ['模组名', '场次名', '手动保存内容'],
    ['公开模组', '公开场次', '完整😀\r\n\0正文尾部']
  ]
  const payload = {
    version: 1,
    supported: true,
    projection: 'records',
    compact: true,
    stringCount: 0,
    strings: {},
    validatedCells: 6,
    sheets: [
      {
        name: '公开表格',
        order: 0,
        mergedRanges: [],
        rows: values.map((cells, index) => ({
          index,
          cells: cells.map((value, column) => [
            String.fromCharCode(65 + column) + (index + 1),
            'str',
            value,
            '',
            '',
            false
          ])
        }))
      }
    ]
  }
  worker.onmessage!({
    data: {
      type: 'start',
      job: {
        source: { ...source, url: 'https://localhost/public.xlsx' },
        recordsKernel: { source, payloadJson: JSON.stringify(payload) },
        format: 'xlsx',
        kind: 'records',
        name: 'public.xlsx',
        maximumStageBytes: Number.MAX_SAFE_INTEGER,
        measure
      }
    }
  })
  return { message: await finished, bytes: Buffer.concat(chunks) }
}

it.each([false, true])(
  'actual records Worker preserves complete bytes and optional Base64 diagnostics: %s',
  async (measure) => {
    const { message, bytes } = await run(measure)
    expect(message.type).toBe('done')
    expect(message.result.candidate).toEqual({
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    })
    expect(JSON.parse(bytes.toString().slice(1)).value.manualContent).toBe('完整😀\r\n\0正文尾部')
    if (measure) expect(message.result.timing.jsCandidateBase64Ms).toBeGreaterThanOrEqual(0)
    else expect(message.result.timing).toBeUndefined()
  }
)

it('actual measured Worker still rejects the append instead of publishing a candidate', async () => {
  const { message } = await run(true, true)
  expect(message).toEqual({ type: 'failed', error: 'native append refused' })
})
