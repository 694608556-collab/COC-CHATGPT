import type { MobileSnapshot } from './types'

/** 生成只含元数据的表格预览基线，正文仍由原快照/原生库持有。
 * @param current 当前列表快照，可以含已读取或延迟读取的正文。
 * @returns 独立记录外壳，不包含旧rawContent/manualContent，也不修改输入。
 */
export function tablePreviewBaseline(current: MobileSnapshot): MobileSnapshot {
  return {
    ...current,
    records: current.records.map((record) => ({ ...record, rawContent: undefined, manualContent: undefined }))
  }
}

/** 用户确认后合并原正文，仅表格明确提供的正文覆盖原值。
 * @param preview 已校验的完整预览候选，不含原有大正文。
 * @param complete 已按同一revision读取全部正文的原快照。
 * @returns 保留预览元数据/新记录/手动更新与其他旧正文的完整候选；调用方仍走原CAS。
 */
export function restoreTableBodies(preview: MobileSnapshot, complete: MobileSnapshot): MobileSnapshot {
  const originals = new Map(complete.records.map((record) => [record.id, record]))
  return {
    ...preview,
    records: preview.records.map((record) => {
      const original = originals.get(record.id)
      return original
        ? {
            ...record,
            rawContent: record.rawContent ?? original.rawContent,
            manualContent: record.manualContent ?? original.manualContent
          }
        : record
    })
  }
}
