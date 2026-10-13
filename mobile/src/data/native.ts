import { registerPlugin } from '@capacitor/core'
import type { DataAction } from './actions'
export { decodeBase64, encodeBase64 } from './bytes'

/** 原生归档目录状态。 */
export interface ArchiveLocation {
  /** SAF 文档树 URI；类型为 string，空串表示尚未选择。 */
  uri: string
  /** 用户可读名称；类型为 string，不作为文件系统路径使用。 */
  label: string
  /** 本次启动实际读写验证结果；类型为 boolean。 */
  valid: boolean
}
/** 原生数据库与授权读取结果。 */
export interface NativeState {
  lastAutoBackupAt?: number
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
export interface LogbookPort {
  listDocuments(options?: { all?: boolean }): Promise<{ documents: SavedDocument[] }>
  readDocument(options: { uri: string }): Promise<{ name: string; mime: string; base64: string }>
  fetchLog(options: { url: string }): Promise<{ status: number; url: string; text: string }>
  automaticBackup(options: {
    json?: string
    expectedRevision: number
  }): Promise<{ document: SavedDocument; savedAt: number; warning?: string }>
  openDocument(options: { uri: string }): Promise<void>
  shareDocument(options: { uri: string }): Promise<void>
  /**
   * 原生端修改已保存快照的列表元数据，正文不通过界面重复传输。
   * @param options - 白名单操作及当前版本；安全副本回读失败或版本过期时拒绝。
   * @returns 新版本、实际保存时间及安全副本，不返回大正文。
   */
  commitAction(options: {
    action: DataAction
    expectedRevision: number
  }): Promise<{ revision: number; exportedAt: string; safetyBackup: SavedDocument }>
  /** 校验后的编辑快照；原生端先写安全副本，再以版本序号进行事务提交。 */
  commitEdit(options: {
    json: string
    expectedRevision: number
  }): Promise<{ revision: number; safetyBackup: SavedDocument }>
  /** @returns 当前持久化状态与实时目录有效性；不修改业务数据。 */
  getState(): Promise<NativeState>
  /** @returns 系统选择并实际验证的目录；取消只返回 cancelled=true。 */
  selectArchive(): Promise<{ cancelled: boolean; archive?: ArchiveLocation }>
  /** @returns 用户明确选择的备份字节；取消不返回内容。 */
  openBackup(options?: {
    kind?: 'backup' | 'record-table' | 'character-table'
  }): Promise<{ cancelled: boolean; base64?: string; name?: string }>
  /**
   * 先回读安全备份，再在 SQLite 事务内覆盖；失败不变更当前业务数据。
   * @param options - 已校验 JSON、预览时序号和用户明确确认标记。
   * @returns 新序号与用户可见的恢复前安全备份。
   */
  commitRestore(options: {
    json: string
    expectedRevision: number
    confirmed: boolean
    attachments?: Array<{ name: string; mime: string; base64: string }>
  }): Promise<{ revision: number; safetyBackup: SavedDocument }>
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

export const Native = registerPlugin<LogbookPort>('Logbook')
