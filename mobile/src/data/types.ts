import type { ModuleRecord, SessionRecord, CharacterData, FilterPreset } from '../../../src/shared/types'

/** 安卓业务快照；不包含资料、闲记、桌面路径或归档附件。 */
export interface MobileSnapshot {
  /** 快照内部结构版本；类型为字面量 2，不是外层备份版本。 */
  schemaVersion: 2
  /** 导出时间；类型为 string，ISO 8601。 */
  exportedAt: string
  /** 模组及参与者；类型为 ModuleRecord[]。 */
  modules: ModuleRecord[]
  /** 场次及已保存正文；类型为 SessionRecord[]。 */
  records: SessionRecord[]
  /** 完整角色业务字段；类型为 CharacterData[]。 */
  characters: CharacterData[]
  /** 可恢复显示设置；目录授权独立管理，不来自备份。 */
  settings: { theme: 'light' | 'dark'; filterPreset: FilterPreset }
}

/** 只读导入预览，用户确认之前不得持久化 snapshot。 */
export interface ImportPreview {
  /** 已校验并排除电脑专属模块的数据；类型为 MobileSnapshot。 */
  snapshot: MobileSnapshot
  /** 有实际正文的场次数量；类型为 number，非链接数量。 */
  offlineRecords: number
  /** 确认前须展示的兼容性说明；类型为 string[]。 */
  warnings: string[]
}
