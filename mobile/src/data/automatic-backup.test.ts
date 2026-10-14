import { expect, it } from 'vitest'
import { automaticBackupDelay } from './automatic-backup'
import { previewBackup } from './backup'
import { exampleBackup } from './fixtures'

it('十分钟到期、有修改才备份；回前台不提前，无修改/关闭不备份，自选每日每周有效', async () => {
  const data = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
  const start = 1800000000000
  data.exportedAt = new Date(start).toISOString()
  data.settings.autoBackup = { enabled: true, interval: 'idle', retention: 10 }
  expect(automaticBackupDelay(data, undefined, start)).toBe(600000)
  expect(automaticBackupDelay(data, undefined, start + 1000)).toBe(599000)
  expect(automaticBackupDelay(data, undefined, start + 600000)).toBe(0)
  expect(automaticBackupDelay(data, start, start + 700000)).toBeUndefined()
  data.exportedAt = new Date(start + 1).toISOString()
  expect(automaticBackupDelay(data, start, start + 1000)).toBe(599000)
  data.settings.autoBackup.interval = 'daily'
  expect(automaticBackupDelay(data, start, start)).toBe(86400000)
  data.settings.autoBackup.interval = 'weekly'
  expect(automaticBackupDelay(data, start, start)).toBe(604800000)
  data.settings.autoBackup.enabled = false
  expect(automaticBackupDelay(data, start, start + 700000000)).toBeUndefined()
})
