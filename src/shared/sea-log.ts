import { createHash } from 'node:crypto'
import type { LogMessage, NormalizedLog, RecordStatus } from './types'
export { applyLogFilters } from './log-filter'

export const SEA_LOG_HOST = 'log.weizaima.com'
export const SEA_API_HOST = 'dice-api.weizaima.com'
export const SEA_PARSER_VERSION = 1

export interface ParsedSeaLogUrl {
  normalizedUrl: string
  key: string
  password?: string
}

export interface ProbeResult {
  status: RecordStatus
  log?: NormalizedLog
  playDate?: string
  error?: string
}

export function parseSeaLogUrl(value: string): ParsedSeaLogUrl {
  if (!/^https?:\/\//i.test(value.trim())) {
    throw new Error('请输入包含 http:// 或 https:// 的完整海豹日志网址')
  }
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 链接')
  if (url.hostname.toLowerCase() !== SEA_LOG_HOST) throw new Error('仅支持 log.weizaima.com 的日志链接')
  if (url.username || url.password || url.port) throw new Error('链接不能包含用户名、密码或自定义端口')
  const key = url.searchParams.get('key')?.trim()
  if (!key) throw new Error('链接缺少 key 参数')
  const password = decodeURIComponent(url.hash.replace(/^#/, '')).trim() || undefined
  return { normalizedUrl: url.toString(), key, password }
}

export function isAllowedSeaRedirect(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      [SEA_LOG_HOST, SEA_API_HOST].includes(url.hostname.toLowerCase()) &&
      !url.username &&
      !url.password &&
      !url.port
    )
  } catch {
    return false
  }
}

function firstValue(source: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) if (source[name] !== undefined && source[name] !== null) return source[name]
  return undefined
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

function locateMessageArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  const source = value as Record<string, unknown>
  for (const key of ['logs', 'messages', 'items', 'records', 'logList', 'data']) {
    const candidate = source[key]
    if (Array.isArray(candidate)) return candidate
    const nested = locateMessageArray(candidate)
    if (nested.length) return nested
  }
  return []
}

function normalizeImages(value: unknown): Array<{ url: string; alt?: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string') return isAllowedAssetUrl(item) ? [{ url: item }] : []
    if (!item || typeof item !== 'object') return []
    const source = item as Record<string, unknown>
    const url = asText(firstValue(source, ['url', 'src', 'originUrl']))
    return isAllowedAssetUrl(url) ? [{ url, alt: asText(source.alt) || undefined }] : []
  })
}

function isAllowedAssetUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}

export function normalizeSeaResponse(payload: unknown, sourceUrl?: string): NormalizedLog {
  const rows = locateMessageArray(payload)
  const messages: LogMessage[] = rows.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const source = item as Record<string, unknown>
    const text = asText(firstValue(source, ['text', 'content', 'message', 'msg', 'rawMessage']))
    const displayName =
      asText(firstValue(source, ['displayName', 'nickname', 'name', 'senderName', 'userName'])) ||
      '未知发言者'
    const type = asText(firstValue(source, ['type', 'messageType', 'msgType'])) || 'text'
    const commandFlag =
      Boolean(firstValue(source, ['isDiceCommand', 'dice', 'isCommand'])) || /^\s*[.!。]\S+/.test(text)
    const offTopicFlag =
      Boolean(firstValue(source, ['isOffTopic', 'offTopic', 'isOoc'])) ||
      /^\s*[（(【[]?ooc[）)】\]]?/i.test(text)
    return [
      {
        id: asText(firstValue(source, ['id', 'messageId', 'uuid'])) || `message-${index + 1}`,
        order: index,
        timestamp: normalizeTimestamp(
          firstValue(source, ['timestamp', 'time', 'createdAt', 'datetime', 'date'])
        ),
        displayName,
        platformAccount: asText(firstValue(source, ['platformAccount', 'userId', 'uid', 'qq'])) || undefined,
        text,
        type,
        isDiceCommand: commandFlag,
        isOffTopic: offTopicFlag,
        images: normalizeImages(firstValue(source, ['images', 'imageList', 'attachments'])),
        raw: source
      }
    ]
  })
  if (!messages.length) throw new Error('响应中没有可识别的日志正文')
  const json = JSON.stringify(payload)
  return {
    title:
      payload && typeof payload === 'object'
        ? asText(firstValue(payload as Record<string, unknown>, ['title', 'name', 'logName'])) || undefined
        : undefined,
    messages,
    sourceUrl,
    responseHash: createHash('sha256').update(json).digest('hex'),
    parserVersion: SEA_PARSER_VERSION
  }
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === 'number') {
    const date = new Date(value < 10_000_000_000 ? value * 1000 : value)
    return Number.isNaN(date.valueOf()) ? undefined : date.toISOString()
  }
  const text = asText(value).trim()
  if (!text) return undefined
  const normalized = text.replace(/年|\//g, '-').replace(/月/g, '-').replace(/日/g, ' ')
  const date = new Date(normalized)
  return Number.isNaN(date.valueOf()) ? text : date.toISOString()
}

export function parsePlayDate(log: NormalizedLog): string | undefined {
  const first = log.messages.find(
    (message) => message.timestamp || /\d{4}[-年/]\d{1,2}[-月/]\d{1,2}/.test(message.text)
  )
  if (!first) return undefined
  const candidate = first.timestamp || first.text
  const match = candidate.match(/(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})/)
  if (!match) return undefined
  const [, year, month, day] = match
  return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`
}

export function parseDateFromText(text: string): string | undefined {
  const match = text.match(/(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})/)
  if (!match) return undefined
  const [, year, month, day] = match
  return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`
}

export function classifyProbe(input: {
  httpStatus?: number
  timedOut?: boolean
  networkError?: boolean
  parsed?: boolean
}): RecordStatus {
  if (input.timedOut || input.networkError) return 'fetch_failed'
  if (input.httpStatus === 404 || input.httpStatus === 410) return 'invalid'
  if (input.httpStatus && input.httpStatus >= 500) return 'fetch_failed'
  if (input.httpStatus && input.httpStatus >= 400) return 'invalid'
  return input.parsed ? 'valid' : 'invalid'
}

export function buildSeaApiUrl(parsed: ParsedSeaLogUrl): string {
  const url = new URL('https://dice-api.weizaima.com/dice/api/load_data')
  url.searchParams.set('key', parsed.key)
  if (parsed.password) url.searchParams.set('password', parsed.password)
  return url.toString()
}
