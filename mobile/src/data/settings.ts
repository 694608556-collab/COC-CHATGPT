import { z } from 'zod'
import type { MobileSnapshot } from './types'

const settingsSchema = z
  .object({
    theme: z.enum(['light', 'dark']),
    filterPreset: z
      .object({
        hideDiceCommands: z.boolean(),
        hideImages: z.boolean(),
        hideOffTopic: z.boolean(),
        hideTime: z.boolean(),
        hidePlatformAccount: z.boolean(),
        hideYearMonthDay: z.boolean(),
        indentFirstLine: z.boolean(),
        darkDisplay: z.boolean()
      })
      .strict(),
    autoBackup: z
      .object({
        enabled: z.boolean(),
        interval: z.enum(['idle', 'daily', 'weekly']),
        retention: z.literal(10)
      })
      .strict()
      .optional()
  })
  .strict()

/**
 * 校验轻量设置契约，不读取、编码或克隆正文。
 * @param input - 完整设置对象；拒绝未知实体/目录字段或错误类型。
 * @returns 可提交的设置；校验失败抛中文错误，不改变原对象。
 */
export function validateSettings(input: unknown): MobileSnapshot['settings'] {
  const result = settingsSchema.safeParse(input)
  if (!result.success) throw new Error('设置数据不合法，未保存任何修改。')
  return result.data
}
