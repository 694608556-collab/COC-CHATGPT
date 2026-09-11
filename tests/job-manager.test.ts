import { describe, expect, it } from 'vitest'
import { JobManager } from '../src/main/job-manager'

describe('background job manager', () => {
  it('continues a 100-item batch when 10 items fail', async () => {
    const manager = new JobManager()
    const ids = Array.from({ length: 100 }, (_, index) => String(index + 1))
    const job = await manager.run('batch-export', ids, async (id) => {
      if (Number(id) % 10 === 0) throw new Error(`第 ${id} 项失败`)
      return id
    })
    expect(job.state).toBe('completed')
    expect(job.results.filter((item) => item.state === 'success')).toHaveLength(90)
    expect(job.results.filter((item) => item.state === 'failed')).toHaveLength(10)
    expect(job.completed).toBe(100)
  })

  it('cancels only items that have not started', async () => {
    const manager = new JobManager()
    const promise = manager.run('cancel-test', ['1', '2', '3'], async (id) => {
      if (id === '1') manager.cancel(manager.active()[0]!.id)
      return id
    })
    const job = await promise
    expect(job.results.map((item) => item.state)).toEqual(['success', 'skipped', 'skipped'])
    expect(job.state).toBe('cancelled')
  })
})
