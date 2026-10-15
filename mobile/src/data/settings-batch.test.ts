import { expect, it, vi } from 'vitest'
import { SettingsBatch } from './settings-batch'
import { searchSample } from '../dev/sample'

function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

it('在途保存不并发，后续筛选和主题合并为最新选择并接续返回版本', async () => {
  const settings = searchSample().settings
  const batch = new SettingsBatch(settings, 7, 'initial')
  const first = gate()
  const save = vi.fn(async ({ expectedRevision }: { expectedRevision: number }) => {
    if (expectedRevision === 7) await first.promise
    return { revision: expectedRevision + 1, exportedAt: 'saved-' + expectedRevision }
  })
  batch.update({ filterPreset: { hideDiceCommands: !settings.filterPreset.hideDiceCommands } })
  const done = batch.flush(save, () => {})
  batch.update({ theme: 'dark', filterPreset: { hideImages: false } })
  batch.update({ filterPreset: { hideTime: false }, autoBackup: { enabled: true } })
  batch.update({ autoBackup: { interval: 'weekly' } })
  expect(save).toHaveBeenCalledTimes(1)
  first.release()
  await done
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls.map(([request]) => request.expectedRevision)).toEqual([7, 8])
  expect(batch.committed).toMatchObject({
    theme: 'dark',
    filterPreset: { hideImages: false, hideTime: false },
    autoBackup: { enabled: true, interval: 'weekly', retention: 10 }
  })
  expect(batch.revision).toBe(9)
})

it('第二笔失败停在最后成功版本，保留最新意图以便显式重试', async () => {
  const batch = new SettingsBatch(searchSample().settings, 3, 'initial')
  const first = gate()
  const save = vi.fn(async ({ expectedRevision }: { expectedRevision: number }) => {
    if (expectedRevision === 4) throw new Error('写入失败')
    await first.promise
    return { revision: 4, exportedAt: 'first-saved' }
  })
  batch.update({ theme: 'dark' })
  const done = batch.flush(save, () => {})
  batch.update({ theme: 'light', filterPreset: { hideTime: false } })
  first.release()
  await expect(done).rejects.toThrow('写入失败')
  expect(batch.committed.theme).toBe('dark')
  expect(batch.desired.theme).toBe('light')
  expect(batch.revision).toBe(4)
  await batch.flush(
    async ({ expectedRevision }) => ({ revision: expectedRevision + 1, exportedAt: 'retry' }),
    () => {}
  )
  expect(batch.committed).toEqual(batch.desired)
  expect(batch.revision).toBe(5)
})

it('版本冲突不覆盖已确认设置，不自动重复提交', async () => {
  const initial = searchSample().settings
  const batch = new SettingsBatch(initial, 1, 'initial')
  const save = vi.fn(async () => {
    throw new Error('数据已变化')
  })
  batch.update({ theme: 'dark' })
  await expect(batch.flush(save, () => {})).rejects.toThrow('数据已变化')
  expect(batch.committed).toEqual(initial)
  expect(batch.revision).toBe(1)
  expect(save).toHaveBeenCalledTimes(1)
})
