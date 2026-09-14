import { describe, expect, it } from 'vitest'
import { applyLogFilters } from '../src/shared/log-filter'
import { DEFAULT_FILTER_PRESET, type LogMessage, type NormalizedLog } from '../src/shared/types'

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
