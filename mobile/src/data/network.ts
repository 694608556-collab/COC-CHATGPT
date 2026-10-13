import { Unzlib } from 'fflate'
import {
  buildSeaApiUrl,
  parseSeaLogUrl,
  normalizeSeaResponse,
  parsePlayDate,
  classifyProbe,
  isAllowedSeaRedirect
} from './sea-parser'
import { decodeBase64 } from './native'
import type { LogbookPort } from './native'
import type { SessionRecord } from '../../../src/shared/types'

export async function fetchRecord(
  port: Pick<LogbookPort, 'fetchLog'>,
  record: SessionRecord
): Promise<SessionRecord> {
  if (record.sourceType !== 'online' || !record.link) throw new Error('此场次没有海豹日志链接。')
  const url = buildSeaApiUrl(parseSeaLogUrl(record.link))
  let reply: Awaited<ReturnType<LogbookPort['fetchLog']>>
  try {
    reply = await port.fetchLog({ url })
  } catch {
    return { ...record, status: 'fetch_failed', lastError: '网络连接失败或超时。已有正文保留，可稍后重试。' }
  }
  if (!isAllowedSeaRedirect(reply.url)) throw new Error('服务返回了不受信任的地址。')
  if (reply.status < 200 || reply.status >= 300)
    return {
      ...record,
      status: classifyProbe({ httpStatus: reply.status }),
      lastError:
        reply.status === 404 || reply.status === 410
          ? '日志不存在或已失效。已有正文保留。'
          : '服务不可用或无权访问。已有正文保留。'
    }
  try {
    let payload: unknown = JSON.parse(reply.text)
    if (
      payload &&
      typeof payload === 'object' &&
      typeof (payload as Record<string, unknown>).data === 'string'
    ) {
      const chunks: Uint8Array[] = []
      let length = 0
      const inflater = new Unzlib((chunk) => {
        length += chunk.length
        if (length > 64 * 1024 * 1024) throw new Error('解压后的正文超过 64 MB。')
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
    const log = normalizeSeaResponse(payload, record.link)
    const hash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
    )
    log.responseHash = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')
    const date = parsePlayDate(log)
    return {
      ...record,
      status: 'valid',
      rawContent: log,
      fetchedAt: new Date().toISOString(),
      cacheSourceUrl: record.link,
      lastError: undefined,
      playDate: record.dateSource === 'manual' ? record.playDate : date,
      dateSource: record.dateSource === 'manual' ? 'manual' : date ? 'parsed' : 'none'
    }
  } catch {
    return { ...record, status: 'fetch_failed', lastError: '响应不是有效的海豹日志正文；已有正文保留。' }
  }
}
