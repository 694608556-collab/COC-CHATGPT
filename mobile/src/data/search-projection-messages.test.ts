import { expect, it } from 'vitest'
import { projectSearchTuples } from './search-projection-messages'
import { DEFAULT_FILTER_PRESET } from '../../../src/shared/types'
import {
  allFilterPresets,
  filterBoundaryLog,
  originalLogFilters
} from '../../../tests/fixtures/log-filter-reference'

it.each(allFilterPresets())(
  'native tuples preserve the independent original complete text for all flags %j',
  (preset) => {
    const log = filterBoundaryLog()
    const tuples = log.messages.map((message) => [
      message.timestamp ?? null,
      message.displayName,
      message.platformAccount ?? null,
      message.text,
      message.isDiceCommand,
      message.isOffTopic,
      message.images.length > 0
    ])
    const before = structuredClone(tuples)
    expect(projectSearchTuples(tuples, preset)).toEqual(
      originalLogFilters(log, preset).map(({ header, text }) => ({ header, text }))
    )
    expect(tuples).toEqual(before)
  }
)

it('validates every tuple and exact field types, including hidden and final messages', () => {
  const good = [null, '公开玩家', null, '完整😀正文', false, false, false]
  const preset = { ...DEFAULT_FILTER_PRESET, hideDiceCommands: true, hideOffTopic: true, hideImages: true }
  for (const rows of [undefined, null, {}, '', 1, false])
    expect(() => projectSearchTuples(rows, preset)).toThrow('数组')
  for (const bad of [null, {}, [], good.slice(1), [...good, 'extra']])
    expect(() => projectSearchTuples([good, bad], preset)).toThrow('字段')
  for (let index = 0; index < 7; index++) {
    const invalid =
      index === 0 || index === 2
        ? [undefined, 1, false, {}, []]
        : index === 1 || index === 3
          ? [undefined, null, 1, false, {}, []]
          : [undefined, null, 0, 1, 'false', {}, []]
    for (const value of invalid) {
      const tuple: unknown[] = [...good]
      tuple[4] = true
      tuple[index] = value
      expect(() => projectSearchTuples([good, tuple], preset), `field ${index}`).toThrow('字段')
    }
  }
  expect(projectSearchTuples([], preset)).toEqual([])
  expect(projectSearchTuples([[null, '', null, '', false, false, false]], DEFAULT_FILTER_PRESET)).toEqual([
    { header: '', text: '' }
  ])
})
