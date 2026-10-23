import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { searchBodyStream } from './body-search-stream'
import { exampleBackup } from './fixtures'
import { DEFAULT_FILTER_PRESET } from '../../../src/shared/types'

it('numeric search phases retain the same complete source proof, hits, counts and cleanup result', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(exampleBackup()))
  const options = { expectedSource: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
    ids: ['r1'], query: '离线', preset: DEFAULT_FILTER_PRESET }
  const source = async function* () { for (let at = 0; at < bytes.length; at += 17) yield bytes.slice(at, at + 17) }
  const baseline = await searchBodyStream(source(), options)
  const measured = await searchBodyStream(source(), { ...options, measure: true })
  const { timing, ...result } = measured
  expect(result).toEqual(baseline)
  expect(result.hits.map((row) => row.id)).toEqual(['r1'])
  expect(Object.keys(timing!).sort()).toEqual(['finalSourceGraphMs','matchMs','projectionBuildMs','projectionCacheMs','recordValidationMs','strictRecordParseMs'])
  expect(Object.values(timing!).every((value) => Number.isFinite(value) && value >= 0)).toBe(true)
  expect(baseline).not.toHaveProperty('timing')
})
