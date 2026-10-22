import { capacity } from './capacity'
import { Unzlib } from 'fflate'
import { decodeBase64 } from './bytes'
import { normalizeSeaResponse } from './sea-parser'
import type { NormalizedLog } from '../../../src/shared/types'

/**
 * 在工作线程解压、规范化并计算海豹正文摘要；不执行网络或写入。
 * @param text - 已通过网络来源／状态检查的原始响应 JSON。
 * @param sourceUrl - 原始场次链接，用于完整保留正文来源。
 * @returns 全部消息及原始字段；解压超过 64MB、格式错误或摘要失败时拒绝，不截断正文。
 */
export async function decodeSeaResponse(text: string, sourceUrl?: string): Promise<NormalizedLog> {
  let payload: unknown = JSON.parse(text)
  if (
    payload &&
    typeof payload === 'object' &&
    typeof (payload as Record<string, unknown>).data === 'string'
  ) {
    const chunks: Uint8Array[] = []
    let length = 0
    const inflater = new Unzlib((chunk) => {
      length += chunk.length
      if (length > capacity.recordResponseBytes) throw new Error('解压后的正文超过 64 MB。')
      chunks.push(chunk)
    })
    const zipped = decodeBase64((payload as { data: string }).data)
    for (let offset = 0; offset < zipped.length; offset += 16384)
      inflater.push(zipped.subarray(offset, offset + 16384), offset + 16384 >= zipped.length)
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    payload = { ...payload, ...JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  }
  const log = normalizeSeaResponse(payload, sourceUrl)
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
  )
  log.responseHash = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')
  return log
}
