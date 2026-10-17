import { createExport } from './export'
import type { ExportFormat } from './export'
import type { ModuleRecord, SessionRecord, FilterPreset } from '../../../src/shared/types'

/** 只读文字导出任务；不和正文读取/导入校验共享耗时 ZIP 队列。 */
export interface ExportJob {
  /** 固定任务类型。 */
  type: 'export'
  /** 所属模组元数据。 */
  module: ModuleRecord
  /** 当前文件有序完整正文，不包含未选场次。 */
  records: SessionRecord[]
  /** 用户已确认的导出过滤规则。 */
  filters: FilterPreset
  /** 不依赖页面画布的格式。 */
  format: Exclude<ExportFormat, 'pdf'>
  /** 是否按模组合成。 */
  combined: boolean
}

/** @param job - 完整、只读的文字导出输入。 @returns 待发布文件字节，不写数据库或归档。 */
export function performExportJob(job: ExportJob) {
  return createExport(job.module, job.records, job.filters, job.format, job.combined)
}
