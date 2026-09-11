import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { AppError } from '../shared/errors'
import {
  buildSeaApiUrl,
  classifyProbe,
  isAllowedSeaRedirect,
  normalizeSeaResponse,
  parsePlayDate,
  parseSeaLogUrl
} from '../shared/sea-log'
import type { SessionRecord } from '../shared/types'
import type { AppRepository } from './repository'

function inflateSeaPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const source = payload as Record<string, unknown>
  if (typeof source.data !== 'string') return payload
  const inflated = zlib.inflateSync(Buffer.from(source.data, 'base64'))
  const parsed = JSON.parse(inflated.toString('utf8')) as unknown
  if (!parsed || typeof parsed !== 'object') return payload
  return { ...source, ...(parsed as Record<string, unknown>) }
}
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export class SeaLogService {
  constructor(
    private readonly repository: AppRepository,
    private readonly cacheRoot: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async probe(recordId: string, timeoutMs = 15_000): Promise<SessionRecord> {
    const record = this.repository.findRecord(recordId)
    if (record.sourceType === 'manual' || record.manualContent) return record
    if (!record.link) throw new AppError('SEA_URL_MISSING', 'VALIDATION', '请先填写海豹完整网址。')
    const parsed = parseSeaLogUrl(record.link)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await this.fetchImpl(buildSeaApiUrl(parsed), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        redirect: 'follow'
      })
      if (response.url && !isAllowedSeaRedirect(response.url))
        throw new AppError('SEA_REDIRECT_REJECTED', 'NETWORK', '海豹服务返回了不受信任的地址。')
      if (!response.ok) {
        const status = classifyProbe({ httpStatus: response.status })
        return this.repository.updateRecord(recordId, {
          status,
          lastError:
            status === 'invalid' ? '链接不存在或无权访问' : `海豹服务暂时不可用（${response.status}）`
        })
      }
      const payload = inflateSeaPayload(await response.json())
      const log = normalizeSeaResponse(payload, record.link)
      const parsedDate = parsePlayDate(log)
      this.writeCache(recordId, record.link, log)
      return this.repository.updateRecord(recordId, {
        status: 'valid',
        rawContent: log,
        fetchedAt: new Date().toISOString(),
        cacheSourceUrl: record.link,
        lastError: undefined,
        playDate: record.dateSource === 'manual' ? record.playDate : parsedDate,
        dateSource: record.dateSource === 'manual' ? 'manual' : parsedDate ? 'parsed' : 'none'
      })
    } catch (error) {
      if (error instanceof AppError && error.code === 'SEA_REDIRECT_REJECTED') throw error
      const reason = error instanceof Error && error.name === 'AbortError' ? '连接超时' : '网络连接失败'
      return this.repository.updateRecord(recordId, { status: 'fetch_failed', lastError: reason })
    } finally {
      clearTimeout(timer)
    }
  }

  readValidCache(recordId: string): SessionRecord['rawContent'] | undefined {
    const record = this.repository.findRecord(recordId)
    if (!record.link || record.cacheSourceUrl !== record.link) return undefined
    const file = path.join(this.cacheRoot, 'records', recordId, 'raw.json')
    if (!fs.existsSync(file)) return record.rawContent
    try {
      const cache = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        sourceUrl?: string
        log?: SessionRecord['rawContent']
      }
      return cache.sourceUrl === record.link ? cache.log : undefined
    } catch {
      return undefined
    }
  }

  private writeCache(recordId: string, sourceUrl: string, log: SessionRecord['rawContent']): void {
    const directory = path.join(this.cacheRoot, 'records', recordId)
    fs.mkdirSync(directory, { recursive: true })
    const temporary = path.join(directory, `raw.${process.pid}.tmp`)
    const destination = path.join(directory, 'raw.json')
    fs.writeFileSync(
      temporary,
      JSON.stringify({ sourceUrl, fetchedAt: new Date().toISOString(), log }),
      'utf8'
    )
    fs.renameSync(temporary, destination)
  }
}
