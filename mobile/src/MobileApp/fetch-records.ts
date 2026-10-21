import { fetchRecord } from '../data/network'
import type { LogbookPort } from '../data/native'
import type { SessionRecord } from '../../../src/shared/types'

/** 单批正文获取的内存内进度，不表示已写入数据库。 */
export interface FetchProgress {
  /** 已完成下载及解析的场次数；number，包含正常返回的失败结果。 */
  completed: number
  /** 本批在线场次总数；number。 */
  total: number
  /** 获取并解析成功的数量；number。 */
  succeeded: number
  /** 网络／正文失败且保留旧正文的数量；number。 */
  failed: number
}

/**
 * 限量并发获取正文，结果保持输入顺序；不写库、不生成备份。
 * @param port - 已有日志网络接口，仍受原生来源、超时和大小限制。
 * @param records - 不重复且只含在线场次的只读输入；原对象不修改。
 * @param options - 内部并发取值 2–4，默认 3；进度只表示内存内结果。
 * @returns 全部获取完成后的新场次；意外异常等待在途任务结束后整批拒绝，调用方不得提交部分结果。
 */
export async function fetchRecords(
  port: Pick<LogbookPort, 'fetchLog'>,
  records: readonly SessionRecord[],
  options: {
    /** 内部网络／解析流水线槽位数；不是界面设置。 */
    concurrency?: 2 | 3 | 4
    /** 只读进度通知，不应执行持久化。 */
    onProgress?: (progress: FetchProgress) => void
    /** 单场已解析结果；仅用于界面进度，不表示已提交。 */
    onResult?: (record: SessionRecord) => void
    /** Android disk staging; await before releasing this slot's body. */
    stageResult?: (record: SessionRecord) => Promise<void>
    /** 自带完整获取/暂存的流水线；resolve 前不得释放槽位或发布进度。 */
    fetchAndStage?: (record: SessionRecord) => Promise<SessionRecord>
    /** 成功暂存后只保留元数据；必须提供 stageResult 或 fetchAndStage。 */
    releaseBodies?: boolean
  } = {}
): Promise<SessionRecord[]> {
  const concurrency = options.concurrency ?? 3
  if (options.releaseBodies && !options.stageResult && !options.fetchAndStage)
    throw new Error('缺少正文暂存接口。')
  if (![2, 3, 4].includes(concurrency)) throw new Error('正文并发数量必须为 2–4。')
  if (
    new Set(records.map((record) => record.id)).size !== records.length ||
    records.some((record) => record.sourceType !== 'online')
  )
    throw new Error('批量获取目标无效。')
  const result = [...records]
  const progress: FetchProgress = { completed: 0, total: records.length, succeeded: 0, failed: 0 }
  let cursor = 0
  let rejected = false
  let reason: unknown
  options.onProgress?.({ ...progress })
  /** @returns 消费一个固定槽位；意外失败后停止领取新目标，但等待其他在途任务收尾。 */
  async function run() {
    while (!rejected && cursor < records.length) {
      const index = cursor++
      try {
        const next = await (options.fetchAndStage
          ? options.fetchAndStage(records[index]!)
          : fetchRecord(port, records[index]!))
        await options.stageResult?.(next)
        const visible = options.releaseBodies
          ? (({ rawContent, manualContent, ...metadata }) => metadata)(next)
          : next
        result[index] = visible
        options.onResult?.(visible)
        progress.completed++
        if (next.status === 'valid') progress.succeeded++
        else progress.failed++
        options.onProgress?.({ ...progress })
      } catch (error) {
        if (!rejected) reason = error
        rejected = true
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, records.length) }, () => run()))
  if (rejected) throw reason
  return result
}
