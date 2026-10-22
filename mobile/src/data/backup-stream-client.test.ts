import { afterEach, expect, it, vi } from 'vitest'
import { previewNativeBackup } from './backup-stream-client'
import type { BackupStreamPort, NativeRestoreSource } from './backup-stream-native'

afterEach(() => vi.unstubAllGlobals())

it.each(['resolve', 'reject'] as const)(
  'backup worker failure waits for an already dispatched native write to %s before releasing its owner',
  async (outcome) => {
    let instance: FakeWorker | undefined
    class FakeWorker {
      onmessage?: (event: { data: Record<string, unknown> }) => void
      onerror?: () => void
      postMessage = vi.fn()
      terminate = vi.fn()
      constructor() {
        instance = this
      }
    }
    vi.stubGlobal('document', {})
    vi.stubGlobal('Worker', FakeWorker)
    let settleWrite!: () => void
    const order: string[] = []
    const append = new Promise<void>((resolve, reject) => {
      settleWrite = () => {
        order.push('write-settled')
        if (outcome === 'resolve') resolve()
        else reject(new Error('native write failed'))
      }
    })
    const port: Required<BackupStreamPort> = {
      appendBackupStage: vi.fn(() => append),
      finishBackupPreview: vi.fn(async () => ({ id: 'owner', revision: 7, offlineRecords: 1 })),
      commitBackupRestore: vi.fn(async () => ({ revision: 8 })),
      cancelBackupStage: vi.fn(async () => {
        order.push('owner-released')
      }),
      createBackupStream: vi.fn(async () => {
        throw new Error('unexpected export')
      }),
      finishBackupExport: vi.fn(async () => {
        throw new Error('unexpected publication')
      })
    }
    const source: NativeRestoreSource = {
      id: 'owner',
      revision: 7,
      format: 'json',
      fileUri: 'https://localhost/_capacitor_file_/public.json',
      bytes: 123,
      sha256: 'a'.repeat(64),
      maximumStageBytes: 10000
    }
    let finished = false
    const result = previewNativeBackup(port, source).catch((error: unknown) => {
      finished = true
      return error
    })
    const worker = instance!
    worker.onmessage!({ data: { type: 'chunk', key: 'candidate', index: 0, base64: 'eA==', request: 1 } })
    expect(port.appendBackupStage).toHaveBeenCalledOnce()
    worker.onerror!()
    await Promise.resolve()
    await Promise.resolve()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(finished).toBe(false)
    expect(port.cancelBackupStage).not.toHaveBeenCalled()
    // A queued late message cannot start another append after termination.
    worker.onmessage!({ data: { type: 'chunk', key: 'candidate', index: 1, base64: 'eA==', request: 2 } })
    expect(port.appendBackupStage).toHaveBeenCalledOnce()
    settleWrite()
    expect(await result).toBeInstanceOf(Error)
    expect(order).toEqual(['write-settled', 'owner-released'])
    expect(port.cancelBackupStage).toHaveBeenCalledExactlyOnceWith({ id: source.id })
    expect(worker.postMessage.mock.calls.map(([message]) => message.type)).toEqual(['start'])
    expect(port.finishBackupPreview).not.toHaveBeenCalled()
    expect(port.commitBackupRestore).not.toHaveBeenCalled()
    expect(port.finishBackupExport).not.toHaveBeenCalled()
  }
)
