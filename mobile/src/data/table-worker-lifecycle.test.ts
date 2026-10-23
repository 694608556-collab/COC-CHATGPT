import { afterEach, expect, it, vi } from 'vitest'
import { previewNativeCoc7 } from './table-stream-client'
import type { NativeTableSource, TableStreamPort } from './table-stream-native'
import { publicCoc7Bytes } from '../../test-fixtures/coc7'
import { previewCoc7Import } from './coc7-import'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('空闲预热只编译代码，重复调用不读文件，空闲失败后重新创建线程', async () => {
  const { warmTableImportWorker } = await import('./table-stream-client')
  const instances: any[] = []
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('document', {})
  vi.stubGlobal('Worker', vi.fn(function () {
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), onerror: undefined as any }
    instances.push(worker)
    return worker
  }))
  warmTableImportWorker()
  warmTableImportWorker()
  expect(instances).toHaveLength(1)
  expect(instances[0].postMessage).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  instances[0].onerror()
  expect(instances[0].terminate).toHaveBeenCalledOnce()
  warmTableImportWorker()
  expect(instances).toHaveLength(2)
  expect(instances[1].postMessage).not.toHaveBeenCalled()
  instances[1].onerror()
})

it('两次完整角色草稿复用计算线程，原生租约每次独立清理且不遗留文件权限', async () => {
  const draft = previewCoc7Import(publicCoc7Bytes(), 'public.xlsx')
  const instances: any[] = []
  vi.stubGlobal('document', {})
  vi.stubGlobal('Worker', vi.fn(function () {
    const worker = {
      onmessage: undefined as any, onerror: undefined as any,
      terminate: vi.fn(),
      postMessage: vi.fn((message: any) => {
        if (message.type === 'start') queueMicrotask(() => worker.onmessage?.({ data: { type: 'done', result: { draft } } }))
      })
    }
    instances.push(worker)
    return worker
  }))
  const cancel = vi.fn(async () => {})
  const port = { appendTableStage: vi.fn(), readTableString: vi.fn(), finishTablePreview: vi.fn(),
    readTablePreview: vi.fn(), commitTableStream: vi.fn(), cancelTableStage: cancel } as TableStreamPort
  const source = { id: 'first-private-owner', fileUri: 'https://localhost/_capacitor_file_/source',
    bytes: 1, sha256: 'a'.repeat(64), revision: 1, name: 'public.xlsx', format: 'xlsx',
    maximumStageBytes: 1024 * 1024 } as NativeTableSource
  expect(await previewNativeCoc7(port, source)).toEqual(draft)
  expect(await previewNativeCoc7(port, { ...source, id: 'second-private-owner' })).toEqual(draft)
  expect(cancel.mock.calls).toEqual([[{ id: 'first-private-owner' }], [{ id: 'second-private-owner' }]])
  expect(port.commitTableStream).not.toHaveBeenCalled()
  expect(instances).toHaveLength(1)
  expect(instances[0].terminate).not.toHaveBeenCalled()
  expect(instances[0].onmessage).toBeNull()
  // Simulate a later thread failure so no module-owned worker survives this test.
  instances[0].onerror()
})
