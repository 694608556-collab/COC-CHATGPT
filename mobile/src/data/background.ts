import { runWorkerJob } from './worker-channel'
import type { FetchWorkerChannel } from './worker-channel'
import { performSnapshotJob, createSnapshotJobSession } from './snapshot-job'
import type { SnapshotJob } from './snapshot-job'
import type { FetchUpload } from './snapshot-job'
import type { TablePreview } from './tables'
import type { ImportPreview, MobileSnapshot } from './types'
import type { NormalizedLog, ModuleRecord, SessionRecord, FilterPreset } from '../../../src/shared/types'
import type { ExportFormat } from './export'
import type { ExportJob } from './export-job'
import { isExportSourceJob } from './export-source'
import type { ExportSourceJob, ExportSource, ExportArchiveReference } from './export-source'
import { combinedExportName } from '../../../src/shared/export-filenames'
import type { TablePhaseTiming } from './table-timing'
import type { UploadWireChunk } from './upload-transfer'

// 解析一次只向 Worker 投递一份响应，避免并发下载后在 Worker／桥接间堆积多份大对象。
let seaQueue: Promise<void> = Promise.resolve()
// Node 验证与实机的独立 Worker 租约状态一致，不与表格/备份的默认租约混用。
const fetchSessions = new Map<FetchWorkerChannel, ReturnType<typeof createSnapshotJobSession>>()

/**
 * 将海豹解压／解析排入单通道后台任务，不在界面同步降级解析。
 * @param text - 完整网络响应 JSON；由调用方的有限流水线槽位持有。
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
 * @param fetchChannel - 可选的独立正文槽位；其上传分段和关闭必须使用同一通道。
 * @returns 只读结果；工作线程失败拒绝，不降级为阻塞界面的计算。
 */
async function runJob<T>(
  job: SnapshotJob | ExportJob | ExportSourceJob,
  fetchChannel?: FetchWorkerChannel
): Promise<T> {
  // Node-only storage tests reuse the same algorithm; browser/Android must use a real worker.
  if (typeof document === 'undefined') {
    if (fetchChannel) {
      let session = fetchSessions.get(fetchChannel)
      if (!session) {
        session = createSnapshotJobSession()
        fetchSessions.set(fetchChannel, session)
      }
      return session(job as SnapshotJob) as Promise<T>
    }
    return (
      isExportSourceJob(job)
        ? await (await import('./export-source')).performExportSourceJob(job)
        : job.type === 'export'
          ? await (await import('./export-job')).performExportJob(job)
          : await performSnapshotJob(job)
    ) as T
  }
  const channel = fetchChannel ?? (job.type === 'export' || isExportSourceJob(job) ? 'export' : 'snapshot')
  return runWorkerJob<T>(channel, job)
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
/** Body-free overview validation; entity counts are constrained by available resources. */
export async function readOverviewInBackground(json: string): Promise<MobileSnapshot> {
  return (await runJob<ImportPreview>({ type: 'read-overview', json })).snapshot
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
  snapshot: MobileSnapshot,
  measure = false
): Promise<{ snapshot: MobileSnapshot; json: string; timing?: TablePhaseTiming }> {
  return runJob({ type: 'prepare', snapshot, ...(measure ? { measure: true } : {}) })
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
  /** 完整 UTF-8 字节数，number，必须可精确计量。 */
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

/**
 * 在同一 Worker 内解析、校验并保留上传字节，正文不经过主线程。
 * @param snapshot - 含完整关联元数据的候选基线。
 * @param record - 去除旧正文的当前在线场次。
 * @param text - 受信任响应，缺失代表已分类的网络失败。
 * @param channel - 可选独立正文槽位，允许下一场处理与当前原生上传重叠。
 * @param losslessTransfer - 仅当原生支持时启用无损分段传输。
 * @returns 无正文的场次元数据及同一完整上传租约；不写原生数据。
 */
export function prepareFetchUploadInBackground(
  snapshot: MobileSnapshot,
  record: SessionRecord,
  text?: string,
  channel?: FetchWorkerChannel,
  losslessTransfer = false
): Promise<FetchUpload> {
  // 当前只上传一场；即使界面已加载其他正文，也不能把它们复制进 Worker。
  return runJob(
    { type: 'prepare-fetch-upload', snapshot: { ...snapshot, records: [] }, record, text, losslessTransfer },
    channel
  )
}

/** @param id - 后台上传租约。 @param index - 零起顺序分段序号。 @param channel - 准备正文时使用的槽位。 @returns 最多 256 KiB 原始字节的 Base64。 */
export function uploadChunkInBackground(
  id: string,
  index: number,
  channel?: FetchWorkerChannel
): Promise<string> {
  return runJob({ type: 'upload-chunk', id, index }, channel)
}
/** @param id - 当前后台上传租约。 @param index - 有序传输段索引。
 * @param channel - 准备正文时使用的独立槽位。 @returns 当前一段的编码、展开长度及完整传输字节，不释放租约。
 */
export function uploadTransferInBackground(
  id: string,
  index: number,
  channel: FetchWorkerChannel
): Promise<UploadWireChunk> {
  return runJob({ type: 'upload-transfer', id, index }, channel)
}
/** @param id - 本次后台上传租约。 @param channel - 准备正文时使用的槽位。 @returns 幂等释放字节确认；不影响其他租约。 */
export function closeUploadInBackground(id: string, channel?: FetchWorkerChannel): Promise<void> {
  return runJob({ type: 'upload-close', id }, channel)
}

/** 后台解析表格并生成独立预览；不改变业务库。
 * @param snapshot 全部正文已读取的基线快照。
 * @param base64 用户所选表格内容。
 * @param name 文件名。
 * @param kind 导入种类。
 * @returns 已校验的候选快照、名称及警告；仍需用户确认和CAS提交。
 */
export function importTableInBackground(
  snapshot: MobileSnapshot,
  base64: string,
  name: string,
  kind: 'records' | 'characters',
  revision?: number
): Promise<TablePreview> {
  return runJob({ type: 'table-import', snapshot, base64, name, kind, revision })
}

/** A lost Worker lease must be previewed again; never replay against a newer revision. */
export function confirmTableInBackground(
  id: string,
  revision: number,
  measure = false
): Promise<{ snapshot: MobileSnapshot; json: string; timing?: TablePhaseTiming }> {
  return runJob({ type: 'table-confirm', id, revision, measure })
}
export function releaseTableInBackground(id: string): Promise<void> {
  return runJob({ type: 'table-release', id })
}
