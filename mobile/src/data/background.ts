import { performSnapshotJob } from './snapshot-job'
import type { SnapshotJob } from './snapshot-job'
import type { ImportPreview, MobileSnapshot } from './types'
import type { NormalizedLog, ModuleRecord, SessionRecord, FilterPreset } from '../../../src/shared/types'
import type { ExportFormat } from './export'
import type { ExportJob } from './export-job'
import { isExportSourceJob } from './export-source'
import type { ExportSourceJob, ExportSource, ExportArchiveReference } from './export-source'
import { combinedExportName } from '../../../src/shared/export-filenames'

/** 任务成功/失败回调，按 number 序号配对，不存放文件权限。 */
interface PendingJob {
  /** 任务所属只读工作通道；单个线程失败不拒绝另一个通道的正常任务。 */
  channel: 'snapshot' | 'export'
  /** 接收只读计算结果的回调。 */
  resolve(value: unknown): void
  /** 接收校验/工作线程错误的回调。 */
  reject(reason: Error): void
}
let worker: Worker | undefined
let exportWorker: Worker | undefined
let sequence = 0
const pending = new Map<number, PendingJob>()
// 解析一次只向 Worker 投递一份响应，避免并发下载后在 Worker／桥接间堆积多份大对象。
let seaQueue: Promise<void> = Promise.resolve()

/**
 * 将海豹解压／解析排入单通道后台任务，不在界面同步降级解析。
 * @param text - 完整网络响应 JSON；仅当前最多 2–4 个流水线槽位持有。
 * @param sourceUrl - 正文的原场次来源地址。
 * @returns 完整正文及摘要；失败释放解析槽位并拒绝，调用方保留旧正文。
 */
export function parseSeaInBackground(text: string, sourceUrl?: string): Promise<NormalizedLog> {
  const result = seaQueue.then(() => runJob<NormalizedLog>({ type: 'sea-response', text, sourceUrl }))
  seaQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

/**
 * 投递到本地打包的工作线程，避免界面处理整份正文。
 * @param job - 不包含写入/确认操作的任务。
 * @returns 只读结果；工作线程失败拒绝，不降级为阻塞界面的计算。
 */
async function runJob<T>(job: SnapshotJob | ExportJob | ExportSourceJob): Promise<T> {
  // Node-only storage tests reuse the same algorithm; browser/Android must use a real worker.
  if (typeof document === 'undefined') {
    return (
      isExportSourceJob(job)
        ? await (await import('./export-source')).performExportSourceJob(job)
        : job.type === 'export'
          ? await (await import('./export-job')).performExportJob(job)
          : await performSnapshotJob(job)
    ) as T
  }
  if (typeof Worker === 'undefined') throw new Error('此 WebView 不支持后台校验，未写入数据。')
  const channel = job.type === 'export' || isExportSourceJob(job) ? 'export' : 'snapshot'
  let target = channel === 'export' ? exportWorker : worker
  if (!target) {
    target = new Worker(channel === 'export' ? 'export-worker.js' : 'snapshot-worker.js')
    if (channel === 'export') exportWorker = target
    else worker = target
    target.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const request = pending.get(event.data.id)
      if (!request) return
      pending.delete(event.data.id)
      if (event.data.error) request.reject(new Error(event.data.error))
      else request.resolve(event.data.result)
    }
    const active = target
    target.onerror = () => {
      const error = new Error('后台校验启动或运行失败，未写入数据。')
      for (const [id, request] of pending)
        if (request.channel === channel) {
          request.reject(error)
          pending.delete(id)
        }
      active.terminate()
      if (channel === 'export') exportWorker = undefined
      else worker = undefined
    }
  }
  const id = ++sequence
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { channel, resolve: (result) => resolve(result as T), reject })
    try {
      target!.postMessage({ id, job })
    } catch (reason) {
      pending.delete(id)
      reject(reason)
    }
  })
}

/** @param bytes - 完整备份字节。 @returns 保留全部既有校验的导入预览。 */
export function previewInBackground(bytes: Uint8Array): Promise<ImportPreview> {
  return runJob({ type: 'preview', bytes })
}
/** @param base64 - 原生返回的完整备份。 @returns 已校验预览，不写入数据。 */
export function previewBase64InBackground(base64: string): Promise<ImportPreview> {
  return runJob({ type: 'preview-base64', base64 })
}
/** @param json - 原生快照缓存。 @returns 重读并校验的完整业务快照。 */
export async function readInBackground(json: string): Promise<MobileSnapshot> {
  return (await runJob<ImportPreview>({ type: 'read', json })).snapshot
}
/**
 * 模拟原生存储的后台完整校验，不把整份正文对象传回界面。
 * @param json - 浏览器开发存储的候选完整快照。
 * @returns 通过既有导入校验的规范 JSON；失败不写入，不跳过任何正文。
 */
export function checkJsonInBackground(json: string): Promise<string> {
  return runJob({ type: 'checked-json', json })
}
/** @param snapshot - 待提交数据。 @returns 校验后的快照及对应 JSON，不执行写入。 */
export function prepareInBackground(
  snapshot: MobileSnapshot
): Promise<{ snapshot: MobileSnapshot; json: string }> {
  return runJob({ type: 'prepare', snapshot })
}
/** @param snapshot - 已通过预览校验的数据。 @returns 供原生安全提交的完整 JSON。 */
export function serializeInBackground(snapshot: MobileSnapshot): Promise<string> {
  return runJob({ type: 'serialize', snapshot })
}
/** @param bytes - 浏览器文件字节。 @returns Base64 文件内容，不在界面逐块编码。 */
export function encodeInBackground(bytes: Uint8Array): Promise<string> {
  return runJob({ type: 'encode', bytes })
}

/**
 * 在只读工作线程中编码完整备份及压缩附件，不在触屏线程 stringify/ZIP 大正文。
 * @param snapshot - 已按版本加载全部正文的完整快照。
 * @param files - 未提供为 JSON，提供为含全部已校验附件的 ZIP；不传目录 URI。
 * @returns 完整备份字节，转移缓冲回调用方；失败不写业务数据或外部文件。
 */
export function backupInBackground(
  snapshot: MobileSnapshot,
  files?: Array<{ name: string; bytes: Uint8Array }>
): Promise<Uint8Array> {
  return runJob({ type: 'backup-export', snapshot, files })
}

/** @param source - 本地只读文件凭证。 @param ids - 必须完整读取的唯一目标。 @returns 后台校验及缓存完成确认，不将正文复制回界面。 */
export function openExportSourceInBackground(source: ExportSource, ids: string[]): Promise<{ id: string }> {
  return runJob({ type: 'export-source-open', source, ids })
}

/** @param id - 本次后台租约 ID。 @returns 释放工作线程正文引用后 resolve；原生私有文件由调用者另行释放。 */
export function closeExportSourceInBackground(id: string): Promise<{ id: string }> {
  return runJob({ type: 'export-source-close', id })
}

/** @param id - 已校验的完整正文租约。 @param name - 界面捕获的备份名。 @param files - 未提供为 JSON，否则逐份校验并打包附件。 @returns 完整备份文件；失败不发布、不遗漏附件。 */
export function backupSourceInBackground(
  id: string,
  name: string,
  files?: ExportArchiveReference[]
): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
  return runJob({ type: 'export-source-backup', id, name, files })
}

/** @param job - 当前只读源中的模组/目标/顺序/过滤与格式。 @returns 完整文件字节；不让正文在 UI 和 Worker 之间反复复制。 */
export async function exportSourceFileInBackground(
  job: Omit<Extract<ExportSourceJob, { type: 'export-source-file' }>, 'type'> & { moduleName: string }
): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
  const { moduleName, ...request } = job
  const name = job.combined ? combinedExportName(moduleName, job.format) : undefined
  const file = await runJob<{ name: string; mime: string; bytes: Uint8Array }>({
    ...request,
    type: 'export-source-file'
  })
  return name ? { ...file, name } : file
}

/**
 * 在后台生成文字类导出，避免 DOCX 构建/ZIP 阻塞触屏；文件编码由发布边界另行处理。
 * @param module - 已加载的所属模组，不读写持久数据。
 * @param records - 按导出顺序排列的完整场次，只包含当前文件所需正文。
 * @param filters - 用户的导出过滤设置。
 * @param format - 不依赖页面画布的格式；PDF 仍走有界流式路径。
 * @param combined - 是否按模组合成。
 * @returns 文件名、MIME 与完整字节；Worker 转移字节所有权，失败不创建文件，不在界面同步降级。
 */
export async function exportInBackground(
  module: ModuleRecord,
  records: SessionRecord[],
  filters: FilterPreset,
  format: Exclude<ExportFormat, 'pdf'>,
  combined: boolean
): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
  // 在点击所在界面捕获日期；Worker 的独立时钟/跨午夜处理不得改变用户确认的命名日期。
  const name = combined ? combinedExportName(module.name, format) : undefined
  const file = await runJob<{ name: string; mime: string; bytes: Uint8Array }>({
    type: 'export',
    module,
    records,
    filters,
    format,
    combined
  })
  return name ? { ...file, name } : file
}

/** @param source - 原生版本校验后封存的只读凭证。 @returns 后台校验的完整快照，不经主线程 JSON 解码。 */
export function readLocalInBackground(source: ExportSource): Promise<MobileSnapshot> {
  return runJob({ type: 'read-local', source })
}
/** @param snapshot - 全部正文已读的候选快照。 @returns 全部校验后的快照、后台分段租约/数量/总长/摘要，不写原生数据。 */
export function prepareUploadInBackground(snapshot: MobileSnapshot): Promise<{
  /** 完整校验后的业务快照；不包含桥接用 JSON 字符串。 */
  snapshot: MobileSnapshot
  /** 完整 UTF-8 字节数，number，至多 64 MiB。 */
  bytes: number
  /** 完整字节 SHA-256，小写十六进制 string。 */
  sha256: string
  /** 本次工作线程内租约 string；关闭旧租约不影响新租约。 */
  id: string
  /** 有序分段数量，number，每段至多 256 KiB。 */
  count: number
}> {
  return runJob({ type: 'prepare-upload', snapshot })
}

/** @param id - 后台上传租约。 @param index - 零起顺序分段序号。 @returns 最多 256 KiB 原始字节的 Base64。 */
export function uploadChunkInBackground(id: string, index: number): Promise<string> {
  return runJob({ type: 'upload-chunk', id, index })
}
/** @param id - 本次后台上传租约。 @returns 幂等释放字节确认；不影响其他租约。 */
export function closeUploadInBackground(id: string): Promise<void> {
  return runJob({ type: 'upload-close', id })
}
