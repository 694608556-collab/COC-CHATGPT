import { afterEach, expect, it, vi } from 'vitest'
import { warmBodySearchWorker } from './backup-stream-client'
afterEach(() => vi.unstubAllGlobals())
it('空闲时只准备搜索线程，不读取正文或提交搜索；启动失败后能够重新准备', () => {
  const messages = vi.fn(),
    terminate = vi.fn()
  const workers: Array<{ onerror?: () => void }> = []
  vi.stubGlobal('document', {})
  const Worker = vi.fn(function () {
    const worker = { postMessage: messages, terminate, onerror: undefined }
    workers.push(worker)
    return worker
  })
  vi.stubGlobal('Worker', Worker)
  warmBodySearchWorker()
  warmBodySearchWorker()
  expect(Worker).toHaveBeenCalledTimes(1)
  expect(messages).not.toHaveBeenCalled()
  workers[0]!.onerror!()
  warmBodySearchWorker()
  expect(Worker).toHaveBeenCalledTimes(2)
  expect(messages).not.toHaveBeenCalled()
  workers[1]!.onerror!()
})
