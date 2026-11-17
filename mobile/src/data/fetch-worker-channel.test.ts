import { afterEach, expect, it, vi } from 'vitest'

/** 可控工作线程替身，仅发送测试构造的消息，不执行业务解析。 */
class ControlledWorker {
  static created: ControlledWorker[] = []
  onmessage?: (event: { data: { id: number; result?: unknown; error?: string } }) => void
  onerror?: () => void
  sent: Array<{ id: number; job: unknown }> = []
  stopped = false
  constructor(readonly url: string) {
    ControlledWorker.created.push(this)
  }
  postMessage(message: { id: number; job: unknown }) {
    this.sent.push(message)
  }
  terminate() {
    this.stopped = true
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  ControlledWorker.created.length = 0
})

it('正文线程失败只拒绝所属任务，另一正文槽和表格通道仍独立完成', async () => {
  vi.stubGlobal('Worker', ControlledWorker)
  const { runWorkerJob } = await import('./worker-channel')
  const first = runWorkerJob('fetch-0', { type: 'public-first' })
  const second = runWorkerJob('fetch-1', { type: 'public-second' })
  const table = runWorkerJob('snapshot', { type: 'public-table' })
  const failed = expect(first).rejects.toThrow('后台校验')
  const [a, b, c] = ControlledWorker.created
  a!.onerror!()
  b!.onmessage!({ data: { id: b!.sent[0]!.id, result: 'complete second body' } })
  c!.onmessage!({ data: { id: c!.sent[0]!.id, result: 'complete table' } })
  await failed
  expect(await second).toBe('complete second body')
  expect(await table).toBe('complete table')
  expect([a!.stopped, b!.stopped, c!.stopped]).toEqual([true, false, false])
  const retry = runWorkerJob('fetch-0', { type: 'public-retry' })
  const next = ControlledWorker.created[3]!
  next.onmessage!({ data: { id: next.sent[0]!.id, result: 'fresh lease' } })
  expect(await retry).toBe('fresh lease')
})
