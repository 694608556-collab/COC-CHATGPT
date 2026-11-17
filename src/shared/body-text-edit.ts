import type { LogMessage, SessionRecord } from './types'

/**
 * 修改一个完整消息的说话者及正文，其余消息和来源字段保持原值。
 * @param record 已完整读取的场次。
 * @param messageId 阅读器展示的稳定消息ID。
 * @param text 确认后的完整正文，允许换行及空字符串。
 * @param speaker 确认后的说话者，省略时沿用原值。
 * @returns 独立的场次候选，目标失效时抛错，输入对象不变。
 */
export function editBodyText(
  record: SessionRecord,
  messageId: string,
  text: string,
  speaker?: string
): SessionRecord {
  if (record.rawContent) {
    if (!record.rawContent.messages.some((message) => message.id === messageId))
      throw new Error('正文已变化，请重新打开后编辑。')
    const messages = record.rawContent.messages.map((message) =>
      message.id === messageId ? { ...message, text, displayName: speaker ?? message.displayName } : message
    )
    // 为手动正文首次添加说话者时创建的结构，继续同步可回导的完整手动文本。
    const structuredManual =
      record.sourceType === 'manual' &&
      messages.every(
        (message) =>
          message.raw !== null && typeof message.raw === 'object' && 'manualSeparator' in message.raw
      )
    return {
      ...record,
      rawContent: { ...record.rawContent, messages },
      ...(structuredManual
        ? {
            manualContent: messages
              .map(
                (message) =>
                  (message.displayName ? message.displayName + '：' : '') +
                  message.text +
                  (message.raw as { manualSeparator: string }).manualSeparator
              )
              .join('')
          }
        : {})
    }
  }
  const match = /^manual-(\d+)$/.exec(messageId)
  if (record.manualContent === undefined || !match) throw new Error('正文已变化，请重新打开后编辑。')
  const parts = record.manualContent.split(/(\r\n|\r|\n)/)
  const index = Number(match[1]) * 2
  if (index >= parts.length) throw new Error('正文已变化，请重新打开后编辑。')
  if (!speaker) {
    parts[index] = text
    return { ...record, manualContent: parts.join('') }
  }
  const messages: LogMessage[] = []
  for (let offset = 0; offset < parts.length; offset += 2) {
    messages.push({
      id: 'manual-' + offset / 2,
      order: offset / 2,
      displayName: offset === index ? speaker : '',
      text: offset === index ? text : parts[offset]!,
      type: 'text',
      isDiceCommand: false,
      isOffTopic: false,
      images: [],
      raw: { manualSeparator: parts[offset + 1] ?? '' }
    })
  }
  parts[index] = speaker + '：' + text
  return { ...record, manualContent: parts.join(''), rawContent: { parserVersion: 1, messages } }
}
