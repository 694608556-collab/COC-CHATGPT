import { readSource } from './local-source'
import { previewBackup, encodeBackup, encodeArchiveBackup } from './backup'
import { createExport } from './export'
import type { ExportFormat } from './export'
import type { MobileSnapshot } from './types'
import type { FilterPreset } from '../../../src/shared/types'

/** 原生提供的不可变只读文件证明；没有数据库、外部写入或远程请求权限。 */
export interface ExportSource {
  /** 本次租约标识；类型为 string，与原生释放 ID 一致。 */
  id: string
  /** Capacitor 同源本地文件映射地址；类型为 string，不接受互联网地址。 */
  url: string
  /** 原生实际文件字节数；类型为 number，最多 64 MiB。 */
  bytes: number
  /** 原生完整字节 SHA-256；类型为 string。 */
  sha256: string
}

/** 已登记归档的只读凭证，附件必须逐份校验，不得因读取失败而遗漏。 */
export interface ExportArchiveReference {
  /** 原归档名称；类型为 string，由备份编码器转为安全 ZIP 路径。 */
  name: string
  /** 同源 Capacitor content 映射；类型为 string，不接受网络地址。 */
  url: string
  /** 登记的实际字节数；类型为 number，允许空文件。 */
  bytes: number
  /** 登记的完整 SHA-256；类型为 string。 */
  sha256: string
}

/** 同一工作线程私有数据源的生命周期和文件生成请求；完整正文不往返界面。 */
export type ExportSourceJob =
  | { type: 'export-source-open'; source: ExportSource; ids: string[] }
  | { type: 'export-source-close'; id: string }
  | { type: 'export-source-backup'; id: string; name: string; files?: ExportArchiveReference[] }
  | {
      type: 'export-source-file'
      id: string
      moduleId: string
      ids: string[]
      filters: FilterPreset
      format: Exclude<ExportFormat, 'pdf'>
      combined: boolean
    }
let current: { id: string; snapshot: MobileSnapshot } | undefined
// 打开含异步读回；独立令牌使关闭/后续打开能作废尚未完成的旧请求。
let opening: { id: string } | undefined

/** @param job - 已知后台任务。 @returns 是否为只读导出数据源任务，不读取业务字段。 */
export function isExportSourceJob(job: { type: string }): job is ExportSourceJob {
  return ['export-source-open', 'export-source-close', 'export-source-file', 'export-source-backup'].includes(
    job.type
  )
}

/**
 * 保存只读源于工作线程内，按已确认顺序生成完整文件；不接触界面或持久业务数据。
 * @param job - 打开/关闭租约或对当前租约导出所选文件。
 * @returns 小型生命周期确认，或可转移的完整文件字节；缺失/重复目标整批拒绝。
 */
export async function performExportSourceJob(job: ExportSourceJob) {
  if (job.type === 'export-source-close') {
    if (current?.id === job.id) current = undefined
    if (opening?.id === job.id) opening = undefined
    return { id: job.id }
  }
  if (job.type === 'export-source-open') {
    current = undefined
    const request = { id: job.source.id }
    opening = request
    const bytes = await readSource(job.source)
    const { snapshot } = await previewBackup(bytes)
    if (opening !== request) throw new Error('导出正文租约已失效。')
    const expected = new Set(job.ids),
      actual = new Set(snapshot.records.map((r) => r.id))
    if (
      expected.size !== job.ids.length ||
      actual.size !== expected.size ||
      [...expected].some((id) => !actual.has(id))
    )
      throw new Error('导出正文读取不完整或目标重复，未创建文件。')
    current = { id: job.source.id, snapshot }
    opening = undefined
    return { id: job.source.id }
  }
  if (!current || current.id !== job.id) throw new Error('导出正文租约已失效。')
  const lease = current
  if (job.type === 'export-source-backup') {
    let bytes: Uint8Array
    if (job.files) {
      const total = job.files.reduce((sum, file) => sum + file.bytes, 0)
      if (job.files.length > 1999 || total > 128 * 1024 * 1024)
        throw new Error('归档附件过大或超过 1999 份，请分批导出。')
      const files = []
      for (const file of job.files) files.push({ name: file.name, bytes: await readSource(file, true) })
      if (current !== lease) throw new Error('导出正文租约已失效。')
      bytes = await encodeArchiveBackup(lease.snapshot, files)
    } else bytes = encodeBackup(lease.snapshot)
    if (current !== lease) throw new Error('导出正文租约已失效。')
    return { name: job.name, mime: job.files ? 'application/zip' : 'application/json', bytes }
  }
  const module = current.snapshot.modules.find((m) => m.id === job.moduleId)
  const rows = new Map(current.snapshot.records.map((r) => [r.id, r]))
  if (
    !module ||
    !job.ids.length ||
    new Set(job.ids).size !== job.ids.length ||
    job.ids.some((id) => rows.get(id)?.moduleId !== job.moduleId)
  )
    throw new Error('导出目标不完整或归属已变化。')
  const file = await createExport(
    module,
    job.ids.map((id) => rows.get(id)!),
    job.filters,
    job.format,
    job.combined
  )
  // DOCX 等生成可能让出工作线程；关闭后迟到的字节不得交给界面发布。
  if (current !== lease) throw new Error('导出正文租约已失效。')
  return file
}
