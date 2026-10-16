import { previewBackup } from './backup'
import { decodeBase64, encodeBase64 } from './bytes'
import type { MobileSnapshot } from './types'
import { decodeSeaResponse } from './sea-response'

/** 只读后台任务；不接触目录授权、数据库或原生写入接口。 */
export type SnapshotJob =
  | { type: 'preview'; bytes: Uint8Array }
  | { type: 'preview-base64'; base64: string }
  | { type: 'read'; json: string }
  | { type: 'checked-json'; json: string }
  | { type: 'prepare'; snapshot: MobileSnapshot }
  | { type: 'serialize'; snapshot: MobileSnapshot }
  | { type: 'encode'; bytes: Uint8Array }
  | {
      /** 只读海豹响应解析任务。 */
      type: 'sea-response'
      /** 原始响应 JSON，不含数据库或归档权限。 */
      text: string
      /** 原场次来源网址；可选，不进行网络访问。 */
      sourceUrl?: string
    }

/**
 * 运行只读文件任务，保留既有大小/结构/ZIP/关联校验。
 * @param job - 明确的解码、校验或编码请求。
 * @returns 校验预览、编码文本、完整海豹正文或校验后的快照与 JSON。
 */
export async function performSnapshotJob(job: SnapshotJob) {
  if (job.type === 'sea-response') return decodeSeaResponse(job.text, job.sourceUrl)
  if (job.type === 'preview') return previewBackup(job.bytes)
  if (job.type === 'preview-base64') return previewBackup(decodeBase64(job.base64))
  if (job.type === 'read') return previewBackup(new TextEncoder().encode(job.json))
  if (job.type === 'checked-json') {
    const checked = await previewBackup(new TextEncoder().encode(job.json))
    return JSON.stringify(checked.snapshot)
  }
  if (job.type === 'encode') return encodeBase64(job.bytes)
  if (job.type === 'serialize') return JSON.stringify(job.snapshot)
  const snapshot = (await previewBackup(new TextEncoder().encode(JSON.stringify(job.snapshot)))).snapshot
  return { snapshot, json: JSON.stringify(snapshot) }
}
