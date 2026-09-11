import type { FilterPreset, NormalizedLog } from './types'

export interface RenderedLogMessage {
  id: string
  header: string
  text: string
  images: Array<{ url: string; alt?: string }>
}

function displayTime(timestamp: string | undefined, hideYearMonthDay: boolean): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.valueOf())) return timestamp
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (hideYearMonthDay) return time
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${time}`
}

export function applyLogFilters(log: NormalizedLog, preset: FilterPreset): RenderedLogMessage[] {
  return log.messages
    .filter((message) => !preset.hideDiceCommands || !message.isDiceCommand)
    .filter((message) => !preset.hideOffTopic || !message.isOffTopic)
    .map((message) => {
      const parts: string[] = []
      if (!preset.hideTime) {
        const time = displayTime(message.timestamp, preset.hideYearMonthDay)
        if (time) parts.push(time)
      }
      parts.push(message.displayName)
      if (!preset.hidePlatformAccount && message.platformAccount) parts.push(`(${message.platformAccount})`)
      return {
        id: message.id,
        header: parts.join(' '),
        text: preset.indentFirstLine ? `\u3000\u3000${message.text}` : message.text,
        images: preset.hideImages ? [] : message.images
      }
    })
}
