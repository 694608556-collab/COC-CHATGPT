import { afterEach, describe, expect, it, vi } from 'vitest'
import { claimWelcome } from './presentation'

afterEach(() => vi.useRealTimers())

describe('首次欢迎许可接口', () => {
  it('仅使用原生已经持久化的一次许可，后续 false 不播放', async () => {
    await expect(claimWelcome({ claimFirstLaunchIntro: async () => ({ show: true }) })).resolves.toBe(true)
    await expect(claimWelcome({ claimFirstLaunchIntro: async () => ({ show: false }) })).resolves.toBe(false)
  })
  it('标记写入失败不播放也不阻断正常启动', async () => {
    await expect(
      claimWelcome({
        claimFirstLaunchIntro: async () => {
          throw new Error('disk full')
        }
      })
    ).resolves.toBe(false)
  })
  it('接口挂起最多等 500ms，迟到的许可不再触发欢迎页', async () => {
    vi.useFakeTimers()
    let release!: (value: { show: boolean }) => void
    const pending = claimWelcome({
      claimFirstLaunchIntro: () =>
        new Promise((resolve) => {
          release = resolve
        })
    })
    await vi.advanceTimersByTimeAsync(500)
    await expect(pending).resolves.toBe(false)
    release({ show: true })
    await expect(pending).resolves.toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
