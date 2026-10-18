import {
  buildSeaApiUrl,
  parseSeaLogUrl,
  parsePlayDate,
  classifyProbe,
  isAllowedSeaRedirect
} from './sea-parser'
import { parseSeaInBackground } from './background'
import type { LogbookPort } from './native'
import type { SessionRecord } from '../../../src/shared/types'

/**
 * 获取一个在线场次，来源检查后交后台单通道解析。
 * @param port - 实际网络适配器；原生限制协议、来源、超时与响应体大小。
 * @param record - 原场次；网络、格式或后台解析失败时保留其原正文。
 * @returns 新场次及有效／失败状态，不修改输入或持久化；不可信跳转等契约错误拒绝。
 */
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
    const log = await parseSeaInBackground(reply.text, record.link)
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
