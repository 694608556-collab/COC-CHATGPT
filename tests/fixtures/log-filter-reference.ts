import type { FilterPreset, LogMessage, NormalizedLog } from '../../src/shared/types'

/** Independent pre-projector behavior copied from Git HEAD be14c639.
 * @param log Complete normalized public log.
 * @param preset Original reading flags.
 * @returns Original filter-chain output without using the production projector.
 */
export function originalLogFilters(log: NormalizedLog, preset: FilterPreset) {
  return log.messages
    .filter((message) => !preset.hideDiceCommands || !message.isDiceCommand)
    .filter(
      (message) => !preset.hideOffTopic || !(message.isOffTopic || /^[\s\u3000]*[\uff08(]/.test(message.text))
    )
    .filter(
      (message) => !preset.hideImages || !(message.images.length > 0 || /\[CQ:[^\]]+\]/i.test(message.text))
    )
    .map((message) => {
      const parts: string[] = []
      if (!preset.hideTime && message.timestamp) {
        const date = new Date(message.timestamp)
        const time = Number.isNaN(date.valueOf())
          ? message.timestamp
          : `${preset.hideYearMonthDay ? '' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} `}${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
        if (time) parts.push(time)
      }
      parts.push(message.displayName)
      if (!preset.hidePlatformAccount && message.platformAccount) parts.push(`(${message.platformAccount})`)
      return {
        id: message.id,
        header: parts.join(' '),
        text: preset.indentFirstLine ? `\u3000\u3000${message.text}` : message.text,
        images: message.images
      }
    })
}

/** Enumerate all eight Boolean flags, including the text-neutral display theme.
 * @returns Every one of the 256 distinct reading presets.
 */
export function allFilterPresets(): FilterPreset[] {
  const flags: Array<keyof FilterPreset> = [
    'hideDiceCommands',
    'hideImages',
    'hideOffTopic',
    'hideTime',
    'hidePlatformAccount',
    'hideYearMonthDay',
    'indentFirstLine',
    'darkDisplay'
  ]
  return Array.from(
    { length: 1 << flags.length },
    (_, mask) =>
      Object.fromEntries(
        flags.map((flag, index) => [flag, Boolean(mask & (1 << index))])
      ) as unknown as FilterPreset
  )
}

/** Build public complete-content and syntax boundaries for filter differential tests.
 * @returns A normalized log with repeated/invalid times and independent flags.
 */
export function filterBoundaryLog(): NormalizedLog {
  const cases: Array<Partial<LogMessage>> = [
    { text: '' },
    { text: '完整😀\r\n\0\uFEFF\ud800独立代理\udc00尾部' },
    { text: '中文e\u0301العربية😀'.repeat(4000) + '完整尾部END' },
    { text: '(OOC)' },
    { text: '\u3000\t\r\n（题外）' },
    { text: '\u00a0\uFEFF(旁白)' },
    { text: '\u200b(不匹配)' },
    { text: '前缀(OOC)' },
    { text: '普通文本', isOffTopic: true },
    { text: '.ra 检定', isDiceCommand: true },
    {
      text: '(骰子图片)[cQ:image,file=x]',
      isDiceCommand: true,
      isOffTopic: true,
      images: [{ url: 'https://example.invalid/public.png', alt: '公开😀' }]
    },
    { text: '首[CQ:image,file=x]尾' },
    { text: '[cq:reply,id=9]' },
    { text: '[CQ:a\nb]' },
    { text: '[CQ:] [CQ:broken [ＣＱ:wide]' },
    { text: '完整图片', images: [{ url: '', alt: '' }] },
    ...[
      undefined,
      '',
      'not-a-date😀',
      'not-a-date😀',
      '2026-10-24T01:02:03.000Z',
      '2026-10-24T01:02:03.000Z',
      undefined,
      '',
      '2026-10-24T09:02:03+08:00',
      '0001-01-01T00:00:00Z',
      '2026-02-30T12:34:00',
      'Invalid Date'
    ].map((timestamp) => ({ timestamp, text: '时间完整正文' })),
    { displayName: '', platformAccount: '' },
    { displayName: '名称😀 (原名)\n', platformAccount: '账号😀\0 (括号)' },
    { displayName: ' ', platformAccount: ' ' },
    { text: '[CQ:a]', timestamp: '2026-10-24T01:02:03.000Z' },
    { timestamp: '2026-10-24T01:02:03.000Z', text: '隐藏消息后的相同时间' }
  ]
  return {
    parserVersion: 1,
    messages: cases.map((extra, order) => ({
      id: `public-${order}`,
      order,
      displayName: '公开玩家',
      platformAccount: '12345',
      text: '正文',
      type: 'text',
      isDiceCommand: false,
      isOffTopic: false,
      images: [],
      ...extra
    }))
  }
}
