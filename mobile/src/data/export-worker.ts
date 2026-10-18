import './snapshot-worker-compat'
import { performExportJob } from './export-job'
import type { ExportJob } from './export-job'
import { performExportSourceJob, isExportSourceJob } from './export-source'
import type { ExportSourceJob } from './export-source'

/** @param event - 应用自身的只读导出任务。 @returns 无返回值；转移完整文件缓冲，不复制/编码整份大文件。 */
async function exportMessage(event: MessageEvent<{ id: number; job: ExportJob | ExportSourceJob }>) {
  const { id, job } = event.data
  try {
    const result = await (isExportSourceJob(job) ? performExportSourceJob(job) : performExportJob(job))
    if ('bytes' in result)
      self.postMessage({ id, result }, { transfer: [result.bytes.buffer as ArrayBuffer] })
    else self.postMessage({ id, result })
  } catch (reason) {
    self.postMessage({ id, error: reason instanceof Error ? reason.message : '后台导出失败，未保存文件。' })
  }
}
self.addEventListener('message', (event) => void exportMessage(event))
