import type { ImportPreview, MobileSnapshot } from './types'
import type { LogbookPort } from './native'

/** 明确的恢复选择，不恢复文件夹授权或桌面私有设置。 */
export interface RestoreOptions {
  /** 用户是否确认覆盖；类型为 boolean。 */
  confirmed: boolean
  /** 是否恢复主题/阅读过滤设置；类型为 boolean。 */
  restoreSettings: boolean
  /** 预览时读取的版本序号；类型为 number。 */
  revision: number
  /** 预览时的当前数据；类型为 MobileSnapshot。 */
  current: MobileSnapshot
}
/**
 * 从预览进入原生安全覆盖流程。
 * @param port - 手机原生持久化与安全备份边界。
 * @param preview - 校验通过的备份预览。
 * @param options - 用户明确选择及预览时的状态。
 * @returns 完成后的版本与安全副本证明。
 */
export async function restoreBackup(port: LogbookPort, preview: ImportPreview, options: RestoreOptions) {
  if (!options.confirmed) throw new Error('需要用户明确确认覆盖。')
  const snapshot = {
    ...preview.snapshot,
    settings: options.restoreSettings ? preview.snapshot.settings : options.current.settings
  }
  return port.commitRestore({
    json: JSON.stringify(snapshot),
    expectedRevision: options.revision,
    confirmed: true
  })
}
