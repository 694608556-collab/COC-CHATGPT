import { describe, expect, it } from 'vitest'
import {
  applyLogFilters,
  buildSeaApiUrl,
  isAllowedSeaRedirect,
  classifyProbe,
  normalizeSeaResponse,
  parsePlayDate,
  parseSeaLogUrl
} from '../src/shared/sea-log'
import { DEFAULT_FILTER_PRESET } from '../src/shared/types'

const fixture = {
  title: '测试模组',
  data: {
    logs: [
      {
        id: '1',
        nickname: '守密人',
        uid: '10001',
        time: '2025-03-08 19:30:00',
        content: '故事开始',
        images: ['https://log.weizaima.com/image/1.png']
      },
      {
        id: '2',
        nickname: '骰娘',
        uid: 'bot',
        time: '2025-03-08 19:31:00',
        content: '.ra 侦查',
        isDiceCommand: true
      },
      {
        id: '3',
        nickname: '玩家',
        uid: '10002',
        time: '2025-03-08 19:32:00',
        content: 'OOC 暂停一下',
        isOffTopic: true
      }
    ]
  }
}

describe('sea log adapter', () => {
  it('accepts only complete safe sea log URLs', () => {
    const parsed = parseSeaLogUrl('https://log.weizaima.com/?key=abc#secret')
    expect(parsed).toMatchObject({ key: 'abc', password: 'secret' })
    expect(buildSeaApiUrl(parsed)).toContain('key=abc')
    expect(() => parseSeaLogUrl('log.weizaima.com/?key=abc')).toThrow('完整')
    expect(() => parseSeaLogUrl('https://example.com/?key=abc')).toThrow('仅支持')
    expect(() => parseSeaLogUrl('https://log.weizaima.com/')).toThrow('key')
    const http = parseSeaLogUrl('http://log.weizaima.com/?key=http')
    expect(http.key).toBe('http')
    expect(() => parseSeaLogUrl('https://user@log.weizaima.com/?key=abc')).toThrow()
    expect(() => parseSeaLogUrl('https://log.weizaima.com:8443/?key=abc')).toThrow()
    expect(isAllowedSeaRedirect('https://dice-api.weizaima.com/dice/api/load_data')).toBe(true)
    expect(isAllowedSeaRedirect('https://log.weizaima.com/?key=abc')).toBe(true)
    expect(isAllowedSeaRedirect('http://dice-api.weizaima.com/dice/api/load_data')).toBe(false)
    expect(isAllowedSeaRedirect('https://evil.example.com/dice/api/load_data')).toBe(false)
  })

  it('normalizes messages and parses the first date before filtering', () => {
    const log = normalizeSeaResponse(fixture, 'https://log.weizaima.com/?key=abc')
    expect(log.messages).toHaveLength(3)
    expect(log.responseHash).toMatch(/^[a-f0-9]{64}$/)
    expect(parsePlayDate(log)).toBe('2025-03-08')
  })

  it('implements every filter independently', () => {
    const log = normalizeSeaResponse(fixture)
    expect(applyLogFilters(log, DEFAULT_FILTER_PRESET)[0]?.header).toBe('19:30 守密人')
    expect(applyLogFilters(log, { ...DEFAULT_FILTER_PRESET, hideDiceCommands: true })).toHaveLength(2)
    expect(applyLogFilters(log, { ...DEFAULT_FILTER_PRESET, hideOffTopic: true })).toHaveLength(2)
    expect(applyLogFilters(log, { ...DEFAULT_FILTER_PRESET, hideImages: true })[0]?.images).toHaveLength(0)
    expect(applyLogFilters(log, { ...DEFAULT_FILTER_PRESET, hideTime: true })[0]?.header).toBe('守密人')
    expect(
      applyLogFilters(log, { ...DEFAULT_FILTER_PRESET, hidePlatformAccount: false })[0]?.header
    ).toContain('(10001)')
    expect(applyLogFilters(log, { ...DEFAULT_FILTER_PRESET, hideYearMonthDay: false })[0]?.header).toContain(
      '2025-03-08'
    )
    expect(applyLogFilters(log, { ...DEFAULT_FILTER_PRESET, indentFirstLine: true })[0]?.text).toBe(
      '　　故事开始'
    )
    expect(applyLogFilters(log, { ...DEFAULT_FILTER_PRESET, darkDisplay: true })).toEqual(
      applyLogFilters(log, DEFAULT_FILTER_PRESET)
    )
  })

  it('does not classify network failures as invalid links', () => {
    expect(classifyProbe({ networkError: true })).toBe('fetch_failed')
    expect(classifyProbe({ timedOut: true })).toBe('fetch_failed')
    expect(classifyProbe({ httpStatus: 503 })).toBe('fetch_failed')
    expect(classifyProbe({ httpStatus: 404 })).toBe('invalid')
    expect(classifyProbe({ httpStatus: 200, parsed: true })).toBe('valid')
  })
})
