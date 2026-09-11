import { randomUUID } from 'node:crypto'

export type JobState = 'queued' | 'running' | 'completed' | 'cancelled'

export interface JobItemResult<T> {
  id: string
  state: 'success' | 'skipped' | 'failed'
  value?: T
  reason?: string
}

export interface JobSnapshot<T> {
  id: string
  type: string
  state: JobState
  total: number
  completed: number
  currentItem?: string
  results: Array<JobItemResult<T>>
}

export class JobManager {
  private readonly jobs = new Map<string, JobSnapshot<unknown>>()
  private readonly cancelled = new Set<string>()

  async run<T>(type: string, itemIds: string[], worker: (id: string) => Promise<T>): Promise<JobSnapshot<T>> {
    const job: JobSnapshot<T> = {
      id: randomUUID(),
      type,
      state: 'queued',
      total: itemIds.length,
      completed: 0,
      results: []
    }
    this.jobs.set(job.id, job as JobSnapshot<unknown>)
    job.state = 'running'
    for (const itemId of itemIds) {
      if (this.cancelled.has(job.id)) {
        job.results.push({ id: itemId, state: 'skipped', reason: '任务已取消' })
        continue
      }
      job.currentItem = itemId
      try {
        job.results.push({ id: itemId, state: 'success', value: await worker(itemId) })
      } catch (error) {
        job.results.push({
          id: itemId,
          state: 'failed',
          reason: error instanceof Error ? error.message : '未知错误'
        })
      }
      job.completed += 1
    }
    job.currentItem = undefined
    job.state = this.cancelled.has(job.id) ? 'cancelled' : 'completed'
    this.cancelled.delete(job.id)
    return job
  }

  cancel(jobId: string): void {
    if (this.jobs.get(jobId)?.state === 'running') this.cancelled.add(jobId)
  }

  active(): Array<JobSnapshot<unknown>> {
    return Array.from(this.jobs.values()).filter((job) => job.state === 'running' || job.state === 'queued')
  }
}
