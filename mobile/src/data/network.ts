import { buildSeaApiUrl, parseSeaLogUrl, classifyProbe, isAllowedSeaRedirect } from './sea-parser'
import { parseSeaInBackground } from './background'
import { withFetchedLog, withParseFailure } from './fetch-result'
import type { LogbookPort } from './native'
import type { SessionRecord } from '../../../src/shared/types'

/**
 * 获取一个在线场次的响应并核对来源，完整解析由调用方安排。
 * @param port - 实际网络适配器；原生限制协议、来源、超时与响应体大小。
 * @param record - 原场次；网络、格式或后台解析失败时保留其原正文。
 * @returns 原场次及待解析字符串，或明确的网络失败场次；不可信跳转拒绝。
 */
export async function requestRecord(
  port: Pick<LogbookPort, 'fetchLog'>,
  record: SessionRecord
): Promise<{ record: SessionRecord; text?: string }> {
  if (record.sourceType !== 'online' || !record.link) throw new Error('此场次没有海豹日志链接。')
  const url = buildSeaApiUrl(parseSeaLogUrl(record.link))
  let reply: Awaited<ReturnType<LogbookPort['fetchLog']>>
  try {
    reply = await port.fetchLog({ url })
  } catch {
    return {
      record: {
        ...record,
        status: 'fetch_failed',
        lastError: '网络连接失败或超时。已有正文保留，可稍后重试。'
      }
    }
  }
  if (!isAllowedSeaRedirect(reply.url)) throw new Error('服务返回了不受信任的地址。')
  if (reply.status < 200 || reply.status >= 300)
    return {
      record: {
        ...record,
        status: classifyProbe({ httpStatus: reply.status }),
        lastError:
          reply.status === 404 || reply.status === 410
            ? '日志不存在或已失效。已有正文保留。'
            : '服务不可用或无权访问。已有正文保留。'
      }
    }
  return { record, text: reply.text }
}

/**
 * 获取并解析完整正文，供不使用原生暂存的调用方使用。
 * @param port - 受原生来源、超时和大小限制的网络接口。
 * @param record - 不修改的原场次。
 * @returns 完整成功场次或保留旧正文的失败状态；不写库。
 */
export async function fetchRecord(
  port: Pick<LogbookPort, 'fetchLog'>,
  record: SessionRecord
): Promise<SessionRecord> {
  const fetched = await requestRecord(port, record)
  if (fetched.text === undefined) return fetched.record
  try {
    return withFetchedLog(record, await parseSeaInBackground(fetched.text, record.link))
  } catch {
    return withParseFailure(record)
  }
}
