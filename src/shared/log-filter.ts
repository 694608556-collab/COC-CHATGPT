import type { FilterPreset, NormalizedLog } from './types'

export interface RenderedLogMessage {
  id: string
  header: string
  text: string
  images: Array<{ url: string; alt?: string }>
}

/** Format exact local calendar fields while reusing a Date and identical displayed minutes.
 * @returns Timestamp formatter; invalid dates retain the complete original string.
 */
function createTimeFormatter() {
  const date = new Date(0)
  let oldHour = NaN,
    oldMinute = NaN,
    oldYear = NaN,
    oldMonth = NaN,
    oldDay = NaN,
    oldHidden: boolean | undefined,
    formatted = ''
  return (timestamp: string | undefined, hideYearMonthDay: boolean): string => {
    if (!timestamp) return ''
    date.setTime(Date.parse(timestamp))
    if (Number.isNaN(date.valueOf())) return timestamp
    const hour = date.getHours(),
      minute = date.getMinutes()
    // Compare actual local calendar fields, rather than inferring them from
    // UTC minute buckets; historical time-zone offsets can include seconds.
    const year = hideYearMonthDay ? 0 : date.getFullYear(),
      month = hideYearMonthDay ? 0 : date.getMonth() + 1,
      day = hideYearMonthDay ? 0 : date.getDate()
    if (
      hour === oldHour &&
      minute === oldMinute &&
      year === oldYear &&
      month === oldMonth &&
      day === oldDay &&
      hideYearMonthDay === oldHidden
    )
      return formatted
    oldHour = hour
    oldMinute = minute
    oldYear = year
    oldMonth = month
    oldDay = day
    oldHidden = hideYearMonthDay
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    formatted = hideYearMonthDay
      ? time
      : `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${time}`
    return formatted
  }
}

/** Render all visible messages without changing their complete text or images.
 * @param log Complete normalized log in its original order.
 * @param preset Current reading filter flags.
 * @returns Visible messages with their original image-array references.
 */
export function applyLogFilters(log: NormalizedLog, preset: FilterPreset): RenderedLogMessage[] {
  const project = createLogTextProjector(preset),
    result: RenderedLogMessage[] = []
  for (const message of log.messages) {
    const text = project(
      message.timestamp,
      message.displayName,
      message.platformAccount,
      message.text,
      message.isDiceCommand,
      message.isOffTopic,
      message.images.length > 0
    )
    if (text) result.push({ id: message.id, ...text, images: message.images })
  }
  return result
}

/** Build the same complete visible text for reading and disposable native search.
 * @param preset Exact current reading filter flags.
 * @returns A projector of validated timestamp, name, account, complete text and
 * dice/off-topic/image flags; hidden messages return undefined. Identical times
 * reuse formatting only while the date-visibility flag is also unchanged.
 */
export function createLogTextProjector(preset: FilterPreset) {
  const displayTime = createTimeFormatter()
  let previousTimestamp: string | undefined,
    previousTime = '',
    previousHideDate = preset.hideYearMonthDay
  return (
    timestamp: string | undefined,
    displayName: string,
    platformAccount: string | undefined,
    text: string,
    isDiceCommand: boolean,
    isOffTopic: boolean,
    hasImages: boolean
  ): Pick<RenderedLogMessage, 'header' | 'text'> | undefined => {
    if (
      (preset.hideDiceCommands && isDiceCommand) ||
      (preset.hideOffTopic && (isOffTopic || /^[\s\u3000]*[\uff08(]/.test(text))) ||
      (preset.hideImages && (hasImages || /\[CQ:[^\]]+\]/i.test(text)))
    )
      return
    if (!preset.hideTime) {
      if (timestamp !== previousTimestamp || preset.hideYearMonthDay !== previousHideDate) {
        previousTimestamp = timestamp
        previousHideDate = preset.hideYearMonthDay
        previousTime = displayTime(timestamp, previousHideDate)
      }
    }
    let header = !preset.hideTime && previousTime ? previousTime + ' ' + displayName : displayName
    if (!preset.hidePlatformAccount && platformAccount) header += ' (' + platformAccount + ')'
    return { header, text: preset.indentFirstLine ? `\u3000\u3000${text}` : text }
  }
}
