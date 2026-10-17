import './snapshot-worker-compat'
import { performExportJob } from './export-job'
import type { ExportJob } from './export-job'

/** @param event - 应用自身的只读导出任务。 @returns 无返回值；转移完整文件缓冲，不复制/编码整份大文件。 */
async function exportMessage(event: MessageEvent<{ id: number; job: ExportJob }>) {
  const { id, job } = event.data
  try {
    const file = await performExportJob(job)
    self.postMessage({ id, result: file }, { transfer: [file.bytes.buffer as ArrayBuffer] })
  } catch (reason) {
    self.postMessage({ id, error: reason instanceof Error ? reason.message : '后台导出失败，未保存文件。' })
  }
}
self.addEventListener('message', (event) => void exportMessage(event))
