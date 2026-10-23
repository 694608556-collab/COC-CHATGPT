import { describe, expect, it } from 'vitest'
import { applyLogFilters, createLogTextProjector } from '../src/shared/log-filter'
import { DEFAULT_FILTER_PRESET, type LogMessage, type NormalizedLog } from '../src/shared/types'
import { allFilterPresets, filterBoundaryLog, originalLogFilters } from './fixtures/log-filter-reference'

function message(id: string, text: string, extra: Partial<LogMessage> = {}): LogMessage {
  return {
    id,
    order: Number(id),
    displayName: '\u73a9\u5bb6',
    text,
    type: 'text',
    isDiceCommand: false,
    isOffTopic: false,
    images: [],
    ...extra
  }
}

const log: NormalizedLog = {
  parserVersion: 1,
  messages: [
    message('1', '\uff08OOC\uff09\u6682\u505c'),
    message('2', '\u4f60\u597d[CQ:image,file=x]'),
    message('3', '\u56de\u590d[CQ:reply,id=9]'),
    message('4', '\u666e\u901a\u53d1\u8a00', {
      images: [{ url: 'https://example.com/a.png' }]
    }),
    message('5', '\u6b63\u5e38\u5bf9\u8bdd')
  ]
}

describe('log filtering rules', () => {
  it.each(allFilterPresets())(
    'matches independent original behavior for every flag combination %j',
    (preset) => {
      const boundary = filterBoundaryLog(),
        before = structuredClone(boundary)
      const actual = applyLogFilters(boundary, preset)
      expect(actual).toEqual(originalLogFilters(boundary, preset))
      expect(boundary).toEqual(before)
      for (const item of actual)
        expect(item.images).toBe(boundary.messages.find((message) => message.id === item.id)!.images)
    }
  )

  it('rechecks date visibility when a projector caller updates flags between identical timestamps', () => {
    const preset = { ...DEFAULT_FILTER_PRESET },
      project = createLogTextProjector(preset)
    const message = { ...filterBoundaryLog().messages[0]!, timestamp: '2026-10-24T01:02:03.000Z' }
    for (const [hideTime, hideYearMonthDay] of [
      [false, true],
      [false, false],
      [true, true],
      [false, true]
    ]) {
      preset.hideTime = hideTime!
      preset.hideYearMonthDay = hideYearMonthDay!
      expect(
        project(
          message.timestamp,
          message.displayName,
          message.platformAccount,
          message.text,
          false,
          false,
          false
        )
      ).toEqual(
        originalLogFilters({ parserVersion: 1, messages: [message] }, preset).map(({ header, text }) => ({
          header,
          text
        }))[0]
      )
    }
  })

  it('removes speeches that start with Chinese or ASCII parentheses', () => {
    const result = applyLogFilters(log, {
      ...DEFAULT_FILTER_PRESET,
      hideOffTopic: true
    })
    expect(result.map((item) => item.id)).toEqual(['2', '3', '4', '5'])
  })

  it('removes complete messages containing CQ codes or images', () => {
    const result = applyLogFilters(log, {
      ...DEFAULT_FILTER_PRESET,
      hideImages: true
    })
    expect(result.map((item) => item.id)).toEqual(['1', '5'])
  })
})
