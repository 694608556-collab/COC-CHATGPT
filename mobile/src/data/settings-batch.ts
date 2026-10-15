import type { MobileSnapshot } from './types'
import { validateSettings } from './settings'

type Settings = MobileSnapshot['settings']
export type SettingsPatch = {
  theme?: Settings['theme']
  filterPreset?: Partial<Settings['filterPreset']>
  autoBackup?: Partial<NonNullable<Settings['autoBackup']>>
}

/** 仅合并小设置；提交严格串行，每次使用上一笔成功返回的版本。 */
export class SettingsBatch {
  desired: Settings
  committed: Settings
  constructor(
    settings: Settings,
    public revision: number,
    public exportedAt: string
  ) {
    this.desired = this.committed = settings
  }
  update(changes: SettingsPatch) {
    this.desired = validateSettings({
      ...this.desired,
      ...changes,
      filterPreset: { ...this.desired.filterPreset, ...changes.filterPreset },
      ...(changes.autoBackup
        ? {
            autoBackup: {
              enabled: false,
              interval: 'idle',
              retention: 10,
              ...this.desired.autoBackup,
              ...changes.autoBackup
            }
          }
        : {})
    })
  }
  async flush(
    save: (options: {
      settings: Settings
      expectedRevision: number
    }) => Promise<{ revision: number; exportedAt: string }>,
    onCommitted: () => void
  ) {
    while (JSON.stringify(this.desired) !== JSON.stringify(this.committed)) {
      const settings = this.desired
      const result = await save({ settings, expectedRevision: this.revision })
      this.committed = settings
      this.revision = result.revision
      this.exportedAt = result.exportedAt
      onCommitted()
    }
  }
}
