import { parsePlayDate } from './sea-parser'
import type { NormalizedLog, SessionRecord } from '../../../src/shared/types'

/**
 * 将完整解析结果关联回原场次，保留手动日期；不写库。
 * @param record - 原场次及来源身份。
 * @param log - 已完整解码的正文。
 * @returns 含完整正文和成功状态的新场次。
 */
export function withFetchedLog(record: SessionRecord, log: NormalizedLog): SessionRecord {
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
}

/** @param record - 原场次。 @returns 保留原正文的解析失败状态，不发布部分正文。 */
export function withParseFailure(record: SessionRecord): SessionRecord {
  return { ...record, status: 'fetch_failed', lastError: '响应不是有效的海豹日志正文；已有正文保留。' }
}
