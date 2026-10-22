import { registerPlugin } from '@capacitor/core'
import type { DataAction } from './actions'
import type { MobileSnapshot } from './types'
import type { BackupStreamPort } from './backup-stream-native'
import type { TableStreamPort } from './table-stream-native'
export { decodeBase64, encodeBase64 } from './bytes'

/** 原生归档目录状态。 */
export interface ArchiveLocation {
  /** SAF 文档树 URI；类型为 string，空串表示尚未选择。 */
  uri: string
  /** 用户可读名称；类型为 string，不作为文件系统路径使用。 */
  label: string
  /** 最近选目录时的读写验证或本次持久授权检查结果；实际文件写入仍独立校验。 */
  valid: boolean
}
/** 原生数据库与授权读取结果。 */
export interface StorageUsage {
  logicalBytes: number
  databaseBytes: number
  availableBytes?: number
}
export interface NativeState {
  storageUsage?: StorageUsage
  backupStreamVersion?: 1
  bodySearchStreamVersion?: 1
  tableDeltaVersion?: 1
  tableStreamVersion?: 1
  lastAutoBackupAt?: number
  lastAutoBackupRevision?: number
  /** 当前是否有活动网络；类型为 boolean，不表示远程日志网站一定可达。 */
  networkConnected: boolean
  /** 最近读取的快照缓存；类型为 string | null，初次或轻量提交后缓存失效时为空。 */
  json: string | null
  /** 单调更新序号；类型为 number，用于拒绝陈旧覆盖。 */
  revision: number
  /** 当前用户选定的文件夹；类型为 ArchiveLocation。 */
  archive: ArchiveLocation
}
/** 写入外部可见目录后的回读证明。 */
export interface SavedDocument {
  purpose?: 'export' | 'backup' | 'safety' | 'auto' | 'import'
  /** 系统文档 URI；类型为 string，不是 root 路径。 */
  uri: string
  /** 实际保存的名称；类型为 string。 */
  name: string
  /** 回读字节数；类型为 number。 */
  bytes: number
  /** 写后回读 SHA256；类型为 string。 */
  sha256: string
}
/** 所有请求/响应与本工程 LogbookPlugin.java 一一对应，不访问推测的 HTTP 接口。 */
export interface LogbookPort extends BackupStreamPort, TableStreamPort {
  createSearchSource?(options: {
    ids: string[]
    expectedRevision: number
  }): Promise<import('./body-search-stream').NativeSearchSource>
  /** Android: private staged results, one revision/CAS transaction for the entire batch. */
  beginFetchBatch?(options: { ids: string[]; expectedRevision: number }): Promise<{ id: string }>
  stageFetchResult?(options: { batchId: string; id: string }): Promise<void>
  finishFetchBatch?(options: { id: string }): Promise<{ revision: number; exportedAt: string }>
  cancelFetchBatch?(options: { id: string }): Promise<void>
  /** @param options - 当前版本及完整 UTF-8 总长/摘要。 @returns 单次私有上传标识，至多 64 MiB，不写业务。 */
  beginSnapshotEdit?(options: {
    expectedRevision: number
    bytes: number
    sha256: string
  }): Promise<{ id: string }>
  /** @param options - 顺序序号与至多 256 KiB 字节的 Base64。 @returns 暂存确认；乱序/重复拒绝。 */
  appendSnapshotEdit?(options: { id: string; index: number; base64: string }): Promise<void>
  /** @param options - 本次完整上传 ID。 @returns 回读/语法/结构/授权/CAS/事务通过后的版本。 */
  finishSnapshotEdit?(options: { id: string }): Promise<{ revision: number }>
  /** @param options - 本次上传 ID。 @returns 幂等清理确认，不删除别人的暂存或已提交数据。 */
  cancelSnapshotEdit?(options: { id: string }): Promise<void>

  /** @param options - 唯一所选 ID 与概览版本。 @returns 完整只读正文的私有文件凭证；相同 CAS/整批校验，不写业务或共享归档。 */
  createExportSource(options: { ids: string[]; expectedRevision: number }): Promise<{
    /** 本次读取租约 ID；类型为 string，仅能释放本租约。 */
    id: string
    /** 本应用私有只读文件 URI；类型为 string，由 Capacitor 本地服务器映射给 Worker。 */
    fileUri: string
    /** 完整文件 UTF-8 字节数；类型为 number，不超过 64 MiB。 */
    bytes: number
    /** 完整私有字节 SHA-256；类型为 string，后台重读后必须匹配。 */
    sha256: string
    /** 成功读取版本；类型为 number，必须与请求相同。 */
    revision: number
  }>
  /** @param options - 当前只读租约 ID。 @returns 删除本次私有读取文件后的确认；不修改场次、版本或归档。 */
  releaseExportSource(options: { id: string }): Promise<void>
  /** @param options - 已完成的 UTF-8 正文暂存标识。 @returns 后台原字体 PDF 任务启动确认；不发布文件。仅 Android 实现。 */
  renderTextPdf(options: { id: string }): Promise<void>
  /** @param options - 当前 PDF 任务标识。 @returns 真实排版/已绘页数/写文件状态；不等待整个生成过程。 */
  getTextPdfProgress(options: { id: string }): Promise<{
    /** 当前阶段；ready 才能发布，failed/cancelled 不生成外部文件。 */
    stage: 'layout' | 'render' | 'write' | 'ready' | 'failed' | 'cancelled'
    /** 当前已绘制页数；类型为 number。 */
    pages: number
    /** 排版确定的总页数；类型为 number，排版时为 0。 */
    total: number
    /** 失败或取消的说明；类型为 string，成功处理中为空。 */
    error: string
  }>
  /** @returns 新的私有 PDF 暂存标识；不创建外部文件、不修改业务数据。最多同时一份。 */
  beginPdfArchive(): Promise<{ id: string }>
  /** @param options - 暂存标识和至多 256 KiB 的顺序 Base64 字节。 @returns 写入确认，累计不超过 64 MB。 */
  appendPdfArchive(options: { id: string; base64: string }): Promise<void>
  /** @param options - 完整暂存标识和安全文件名。 @returns 新建且回读校验的文件；失败删除本次新文件，不覆盖旧文件。 */
  finishPdfArchive(options: { id: string; name: string }): Promise<SavedDocument>
  /** @param options - 同一有界私有暂存、文件名和已生成文字格式 MIME。 @returns 流式发布与回读证明，不把整个大文件 Base64 传过桥。 */
  finishExportArchive(options: {
    id: string
    name: string
    mime: string
    purpose?: 'export' | 'backup'
  }): Promise<SavedDocument>
  /** @param options - 本次私有暂存标识。 @returns 清理确认；已清理标识可重复取消，不删除已发布文件。 */
  cancelPdfArchive(options: { id: string }): Promise<void>
  /** Cold start reads complete metadata only. Body IDs remain in native storage until requested. */
  getOverview(): Promise<NativeState & { deferredRecordIds: string[] }>
  /** Selected bodies at exactly the caller's revision; never returns a partial successful batch. */
  getRecordContent(options: {
    ids: string[]
    expectedRevision: number
  }): Promise<{ json: string; revision: number }>
  /** 仅提交一个角色或场次草稿；场次不接收在线正文，原生保留未变化来源的正文。 */
  commitEntity(options: {
    edit: Exclude<import('./edit').Edit, { kind: 'module' }>
    expectedRevision: number
  }): Promise<{ revision: number; exportedAt: string }>
  /** @param options - 已校验的模组及读取版本，不带正文。 @returns 事务确认的新版本及时间。 */
  commitModule(options: {
    value: import('../../../src/shared/types').ModuleRecord
    expectedRevision: number
  }): Promise<{ revision: number; exportedAt: string }>
  /** @returns 轻量版本/授权状态；不传输正文、不创建文件。 */
  getStatus(): Promise<
    Pick<NativeState, 'revision' | 'archive' | 'lastAutoBackupAt' | 'lastAutoBackupRevision'>
  >
  /**
   * 仅提交完整设置；原生校验当前数据并事务更新设置及时间，不接收实体或生成全量副本。
   * @param options - 小设置对象及已读取版本；保留目录授权与 CAS 检查。
   * @returns 持久化成功的新版本和实际时间；不返回正文缓存。
   */
  commitSettings(options: {
    settings: MobileSnapshot['settings']
    expectedRevision: number
  }): Promise<{ revision: number; exportedAt: string }>
  /** @param options - all 读取完整登记；metadataOnly 仅在 all 时跳过存在性查询，备份须自行逐份回读并校验，缺失不能遗漏。 @returns 登记证明，不授予额外文件权限。 */
  listDocuments(options?: { all?: boolean; metadataOnly?: boolean }): Promise<{ documents: SavedDocument[] }>
  readDocument(options: { uri: string }): Promise<{ name: string; mime: string; base64: string }>
  fetchLog(options: { url: string }): Promise<{ status: number; url: string; text: string }>
  automaticBackup(options: {
    json?: string
    expectedRevision: number
  }): Promise<{ document: SavedDocument; savedAt: number; revision: number; warning?: string }>
  openDocument(options: { uri: string }): Promise<void>
  shareDocument(options: { uri: string }): Promise<void>
  /**
   * 原生端修改已保存快照的列表元数据，正文不通过界面重复传输。
   * @param options - 白名单操作及当前版本；批量删除一次提交全部已选 ID，不创建操作前副本。
   * @returns 新版本与实际保存时间，不返回大正文。
   */
  commitAction(options: {
    action: DataAction
    expectedRevision: number
  }): Promise<{ revision: number; exportedAt: string; safetyBackup?: SavedDocument }>
  /** 表格增量确认：候选只含元数据与明确导入的手动正文，原生事务保留旧正文。
   * @param options 已校验候选JSON与预览版本；不能删除或更改旧场次来源。
   * @returns 一次CAS提交的新版本；失败不发布部分导入。
   */
  commitTableDelta?: NonNullable<LogbookPort['commitTable']>
  commitTable?(options: {
    json: string
    expectedRevision: number
    /** Optional content-free diagnostics; never changes authorization, validation or writes. */
    measure?: boolean
  }): Promise<{ revision: number; exportedAt?: string; timing?: import('./table-timing').TablePhaseTiming }>
  /** 校验后的编辑快照；直接保存，不创建操作前副本，保留授权、版本检查及事务。 */
  commitEdit(options: {
    json: string
    expectedRevision: number
  }): Promise<{ revision: number; safetyBackup?: SavedDocument }>
  /** @returns 当前持久化状态与实时目录有效性；不修改业务数据。 */
  getState(): Promise<NativeState>
  /** @returns 系统选择并实际验证的目录；取消只返回 cancelled=true。 */
  selectArchive(): Promise<{ cancelled: boolean; archive?: ArchiveLocation }>
  /** @returns 用户明确选择的备份字节；取消不返回内容。 */
  openBackup(options?: {
    kind?: 'backup' | 'record-table' | 'character-table'
    stream?: boolean
    expectedRevision?: number
  }): Promise<{
    cancelled: boolean
    base64?: string
    name?: string
    source?: import('./backup-stream-native').NativeRestoreSource
    tableSource?: import('./table-stream-native').NativeTableSource
  }>
  /**
   * 显式确认后在 SQLite 事务内覆盖；校验或提交失败不变更当前业务数据。
   * @param options - 已校验 JSON、预览时序号和用户明确确认标记。
   * @returns 新序号；不生成操作前副本。
   */
  commitRestore(options: {
    json: string
    expectedRevision: number
    confirmed: boolean
    attachments?: Array<{ name: string; mime: string; base64: string }>
  }): Promise<{ revision: number; safetyBackup?: SavedDocument }>
  /**
   * 创建新文件，不覆盖同名用户文件；成功前校验实际回读字节。
   * @param options - 安全文件名、MIME 类型与 Base64 文件字节。
   * @returns 回读证明。
   */
  writeArchive(options: {
    name: string
    mime: string
    base64: string
    purpose?: 'export' | 'backup'
  }): Promise<SavedDocument>
}

export const Native = registerPlugin<LogbookPort & import('./presentation').PresentationPort>('Logbook')
