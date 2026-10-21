import { expect, it } from 'vitest'
import { performSnapshotJob } from './snapshot-job'
import { searchSample } from '../dev/sample'
import type { TablePhaseTiming } from './table-timing'

it('opt-in prepare timings preserve the exact validated result and contain durations only', async () => {
  const sample = searchSample()
  const original = structuredClone(sample)
  const plain = await performSnapshotJob({ type: 'prepare', snapshot: sample })
  const timed = (await performSnapshotJob({ type: 'prepare', snapshot: sample, measure: true })) as {
    snapshot: typeof sample
    json: string
    timing: TablePhaseTiming
  }
  expect(plain).toEqual({ snapshot: timed.snapshot, json: timed.json })
  expect(sample).toEqual(original)
  expect(Object.keys(timed.timing).sort()).toEqual(['clock', 'phasesMs', 'totalMs'])
  expect(timed.timing.clock).toBe('worker-monotonic')
  expect(Object.keys(timed.timing.phasesMs)).toEqual([
    'inputJson',
    'utf8Encode',
    'decodeParseValidate',
    'outputJson'
  ])
  const phases = Object.values(timed.timing.phasesMs)
  expect(phases.every((ms) => Number.isFinite(ms) && ms >= 0)).toBe(true)
  expect(timed.timing.totalMs).toBeGreaterThanOrEqual(phases.reduce((a, b) => a + b, 0))
})

it('measurement cannot bypass complete structure or relationship validation', async () => {
  const invalid = searchSample()
  invalid.records[0]!.moduleId = 'public-missing-module'
  for (const measure of [false, true]) {
    await expect(performSnapshotJob({ type: 'prepare', snapshot: invalid, measure })).rejects.toThrow()
    await expect(
      performSnapshotJob({ type: 'prepare', snapshot: { ...invalid, schemaVersion: 999 } as never, measure })
    ).rejects.toThrow()
  }
})
