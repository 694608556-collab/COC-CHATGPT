import { registerPlugin } from '@capacitor/core'

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
  /** 当前是否有活动网络；类型为 boolean，不表示远程日志网站一定可达。 */
  networkConnected: boolean
  /** 已保存业务快照 JSON；类型为 string | null，初次为空。 */
  json: string | null
  /** 单调更新序号；类型为 number，用于拒绝陈旧覆盖。 */
  revision: number
  /** 当前用户选定的文件夹；类型为 ArchiveLocation。 */
  archive: ArchiveLocation
}
/** 写入外部可见目录后的回读证明。 */
export interface SavedDocument {
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
  /** @returns 当前持久化状态与实时目录有效性；不修改业务数据。 */
  getState(): Promise<NativeState>
  /** @returns 系统选择并实际验证的目录；取消只返回 cancelled=true。 */
  selectArchive(): Promise<{ cancelled: boolean; archive?: ArchiveLocation }>
  /** @returns 用户明确选择的备份字节；取消不返回内容。 */
  openBackup(): Promise<{ cancelled: boolean; base64?: string; name?: string }>
  /**
   * 先回读安全备份，再在 SQLite 事务内覆盖；失败不变更当前业务数据。
   * @param options - 已校验 JSON、预览时序号和用户明确确认标记。
   * @returns 新序号与用户可见的恢复前安全备份。
   */
  commitRestore(options: {
    json: string
    expectedRevision: number
    confirmed: boolean
  }): Promise<{ revision: number; safetyBackup: SavedDocument }>
  /**
   * 创建新文件，不覆盖同名用户文件；成功前校验实际回读字节。
   * @param options - 安全文件名、MIME 类型与 Base64 文件字节。
   * @returns 回读证明。
   */
  writeArchive(options: { name: string; mime: string; base64: string }): Promise<SavedDocument>
}

export const Native = registerPlugin<LogbookPort>('Logbook')

/**
 * 将原生文件字节还原为 Uint8Array。
 * @param value - 原生返回的 Base64。
 * @returns 原始字节，不执行其中内容。
 */
export function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}
/**
 * 编码待保存文件，分块避免大量正文超出函数实参数量限制。
 * @param bytes - UTF-8 文本或二进制文件。
 * @returns 原生桥接所需的 Base64。
 */
export function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 16384)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 16384)))
  return btoa(chunks.join(''))
}
