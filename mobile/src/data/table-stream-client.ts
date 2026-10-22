import { Capacitor } from '@capacitor/core'
import type { TableStreamPort, NativeTableSource, NativeTablePreview } from './table-stream-native'
import { performTableStreamJob } from './table-stream-job'
import type { TableStreamJob } from './table-stream-job'
import { checkStreamCancelled } from './stream-json'
import { encodeBase64, decodeBase64 } from './bytes'
import { capacity } from './capacity'

function required(port: TableStreamPort): Required<TableStreamPort> {
  for (const method of [
    'appendTableStage',
    'readTableString',
    'finishTablePreview',
    'readTablePreview',
    'commitTableStream',
    'cancelTableStage'
  ] as const)
    if (!port[method]) throw new Error('本机缺少大表格导入能力，请更新应用。')
  return port as Required<TableStreamPort>
}
async function run(job: TableStreamJob, port: Required<TableStreamPort>, id: string, signal?: AbortSignal) {
  checkStreamCancelled(signal)
  if (typeof document === 'undefined') {
    const indexes = { candidate: 0, strings: 0 }
    return performTableStreamJob(
      job,
      async (key, bytes) => {
        await port.appendTableStage({ id, key, index: indexes[key]++, base64: encodeBase64(bytes) })
      },
      async (stringIndex) => {
        const decoder = new TextDecoder('utf-8', { fatal: true }),
          parts: string[] = []
        let offset = 0,
          expected: number | undefined
        while (true) {
          checkStreamCancelled(signal)
          const value = await port.readTableString({ id, stringIndex, offset }),
            bytes = decodeBase64(value.base64)
          if (
            !Number.isSafeInteger(value.bytes) ||
            value.bytes < 0 ||
            value.bytes > capacity.snapshotRequestBytes ||
            (expected !== undefined && expected !== value.bytes) ||
            bytes.length > capacity.transferChunkBytes ||
            offset + bytes.length > value.bytes ||
            (!bytes.length && !value.done)
          )
            throw new Error('表格字符串证明无效。')
          expected = value.bytes
          offset += bytes.length
          if (value.done !== (offset === expected)) throw new Error('表格字符串未完整读取。')
          parts.push(decoder.decode(bytes, { stream: !value.done }))
          if (value.done) return parts.join('')
        }
      },
      signal
    )
  }
  if (typeof Worker === 'undefined') throw new Error('此环境缺少后台表格处理能力。')
  const worker = new Worker('table-stream-worker.js'),
    inFlight = new Set<Promise<void>>()
  let active = true,
    abort: (() => void) | undefined
  try {
    return await new Promise<Awaited<ReturnType<typeof performTableStreamJob>>>((resolve, reject) => {
      abort = () => reject(new Error('表格导入已取消。'))
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) {
        abort()
        return
      }
      worker.onmessage = ({ data }) => {
        if (data.type === 'done') {
          resolve(data.result)
          return
        }
        if (data.type === 'failed') {
          reject(new Error(data.error))
          return
        }
        if (data.type !== 'chunk' && data.type !== 'read-string') return
        const task = (async () => {
          try {
            const result =
              data.type === 'chunk'
                ? await port.appendTableStage({ id, key: data.key, index: data.index, base64: data.base64 })
                : await port.readTableString({ id, stringIndex: data.stringIndex, offset: data.offset })
            if (active) worker.postMessage({ type: 'reply', request: data.request, result })
          } catch (error) {
            if (active)
              worker.postMessage({
                type: 'reply',
                request: data.request,
                error: error instanceof Error ? error.message : '表格私有暂存失败。'
              })
          }
        })()
        inFlight.add(task)
        void task.finally(() => inFlight.delete(task))
      }
      worker.onerror = () => reject(new Error('表格后台处理失败，尚未确认导入。'))
      worker.postMessage({ type: 'start', job })
    })
  } finally {
    active = false
    if (abort) signal?.removeEventListener('abort', abort)
    worker.terminate()
    // Settle already-dispatched native writes before releasing their owner.
    await Promise.allSettled(inFlight)
  }
}
export async function previewNativeTable(
  port: TableStreamPort,
  source: NativeTableSource,
  kind: 'records' | 'characters',
  signal?: AbortSignal
): Promise<NativeTablePreview> {
  try {
    const device = required(port)
    if (
      !source.id ||
      !Number.isSafeInteger(source.revision) ||
      source.revision < 0 ||
      !['csv', 'xlsx', 'xls'].includes(source.format)
    )
      throw new Error('表格来源凭证无效。')
    const result = await run(
      {
        source: {
          bytes: source.bytes,
          sha256: source.sha256,
          url: Capacitor.convertFileSrc(source.fileUri),
          ranged: Capacitor.getPlatform() === 'ios'
        },
        name: source.name,
        format: source.format,
        kind,
        maximumStageBytes: source.maximumStageBytes
      },
      device,
      source.id,
      signal
    )
    checkStreamCancelled(signal)
    if (!result.candidate) throw new Error('表格候选未生成，未确认导入。')
    const preview = await device.finishTablePreview({ id: source.id, candidate: result.candidate })
    checkStreamCancelled(signal)
    if (
      preview.id !== source.id ||
      preview.revision !== source.revision ||
      [preview.added, preview.updated, preview.skipped, preview.namesCount, preview.warningsCount].some(
        (n) => !Number.isSafeInteger(n) || n < 0
      ) ||
      !Array.isArray(preview.names) ||
      !Array.isArray(preview.warnings) ||
      preview.names.length > 100 ||
      preview.warnings.length > 100 ||
      preview.names.length > preview.namesCount ||
      preview.warnings.length > preview.warningsCount ||
      [...preview.names, ...preview.warnings].some((x) => typeof x !== 'string')
    )
      throw new Error('表格预览证明不一致，不能确认。')
    return preview
  } catch (error) {
    try {
      if (!port.cancelTableStage) throw new Error('缺少暂存释放接口。')
      await port.cancelTableStage({ id: source.id })
    } catch {
      throw new Error(
        (error instanceof Error ? error.message : '表格预览失败。') + ' 私有暂存清理失败，请重开应用后重试。'
      )
    }
    throw error
  }
}
/** A single character draft retains all validation and never writes production data. */
export async function previewNativeCoc7(
  port: TableStreamPort,
  source: NativeTableSource,
  signal?: AbortSignal
) {
  try {
    const device = required(port)
    const result = await run(
      {
        source: {
          bytes: source.bytes,
          sha256: source.sha256,
          url: Capacitor.convertFileSrc(source.fileUri),
          ranged: Capacitor.getPlatform() === 'ios'
        },
        name: source.name,
        format: source.format,
        kind: 'coc7',
        maximumStageBytes: source.maximumStageBytes
      },
      device,
      source.id,
      signal
    )
    checkStreamCancelled(signal)
    if (!result.draft) throw new Error('未生成完整角色草稿。')
    await device.cancelTableStage({ id: source.id })
    return result.draft
  } catch (error) {
    try {
      if (!port.cancelTableStage) throw new Error('缺少暂存释放接口。')
      await port.cancelTableStage({ id: source.id })
    } catch {
      throw new Error(
        (error instanceof Error ? error.message : '角色卡预览失败。') + ' 私有暂存清理失败，请重开应用。'
      )
    }
    throw error
  }
}
export async function confirmNativeTable(port: TableStreamPort, id: string) {
  const device = required(port)
  let saved: Awaited<ReturnType<typeof device.commitTableStream>> | undefined
  try {
    saved = await device.commitTableStream({ id, confirmed: true })
  } catch (error) {
    try {
      await device.cancelTableStage({ id })
    } catch {
      throw new Error(
        (error instanceof Error ? error.message : '表格保存失败。') + ' 私有暂存清理失败，请重开应用。'
      )
    }
    throw error
  }
  try {
    await device.cancelTableStage({ id })
  } catch {
    saved.warning = [saved.warning, '表格已保存，但私有暂存清理失败，请重开应用。'].filter(Boolean).join(' ')
  }
  return saved
}
