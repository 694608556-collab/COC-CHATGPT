import { describe, expect, it } from 'vitest'
import { previewBackup } from './backup'
import { restoreBackup } from './restore'
import { exampleBackup } from './fixtures'
import type { LogbookPort, NativeState } from './native'

/**
 * 模拟原生存储这一系统边界，不模拟应用内部服务。
 * @param failSafety - 文件系统是否拒绝创建安全副本。
 * @returns 可通过公开 getState 观察的原生端口。
 */
function deviceStore(failSafety = false): LogbookPort {
  let state: NativeState = {
    networkConnected: false,
    json: null,
    revision: 0,
    archive: { uri: 'content://example/tree', label: '测试目录', valid: true }
  }
  return {
    listDocuments: async () => ({ documents: [] }),
    readDocument: async () => {
      throw new Error('测试未调用归档读取')
    },
    fetchLog: async () => {
      throw new Error('测试未调用联网')
    },
    automaticBackup: async () => {
      throw new Error('测试未调用自动备份')
    },
    openDocument: async () => {
      throw new Error('测试未调用打开')
    },
    shareDocument: async () => {
      throw new Error('测试未调用分享')
    },
    commitEdit: async () => {
      throw new Error('测试未调用编辑')
    },
    commitSettings: async () => {
      throw new Error('测试未调用设置')
    },
    commitAction: async () => {
      throw new Error('测试未调用列表操作')
    },
    getState: async () => ({ ...state }),
    selectArchive: async () => ({ cancelled: true }),
    openBackup: async () => ({ cancelled: true }),
    writeArchive: async () => {
      throw new Error('测试未调用此能力')
    },
    commitRestore: async ({ json, expectedRevision, confirmed }) => {
      if (!confirmed) throw new Error('未确认')
      if (expectedRevision !== state.revision) throw new Error('已变化')
      if (failSafety) throw new Error('安全备份失败')
      state = { ...state, json, revision: state.revision + 1 }
      return {
        revision: state.revision,
        safetyBackup: {
          uri: 'content://example/safety.json',
          name: 'safety.json',
          bytes: 1,
          sha256: 'example'
        }
      }
    }
  }
}

describe('恢复确认与持久化公共边界', () => {
  it('用户未确认覆盖时不会改变保存的数据', async () => {
    const device = deviceStore()
    const preview = await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))
    await expect(
      restoreBackup(device, preview, {
        confirmed: false,
        restoreSettings: false,
        revision: 0,
        current: preview.snapshot
      })
    ).rejects.toThrow('确认')
    expect((await device.getState()).json).toBeNull()
  })
  it('不勾选恢复设置时保留当前显示设置，导入数据仍可通过公开读取取回', async () => {
    const device = deviceStore()
    const preview = await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))
    const current = {
      ...preview.snapshot,
      settings: { ...preview.snapshot.settings, theme: 'light' as const }
    }
    await restoreBackup(device, preview, {
      confirmed: true,
      restoreSettings: false,
      revision: 0,
      current
    })
    expect(JSON.parse((await device.getState()).json!).settings.theme).toBe('light')
  })
  it('安全副本创建失败时当前保存数据不变', async () => {
    const device = deviceStore(true)
    const preview = await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))
    await expect(
      restoreBackup(device, preview, {
        confirmed: true,
        restoreSettings: true,
        revision: 0,
        current: preview.snapshot
      })
    ).rejects.toThrow('安全备份失败')
    expect((await device.getState()).json).toBeNull()
  })
  it('覆盖序号过期时不改变已保存的正文', async () => {
    const device = deviceStore()
    const preview = await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))
    await restoreBackup(device, preview, {
      confirmed: true,
      restoreSettings: true,
      revision: 0,
      current: preview.snapshot
    })
    await expect(
      restoreBackup(device, preview, {
        confirmed: true,
        restoreSettings: true,
        revision: 0,
        current: preview.snapshot
      })
    ).rejects.toThrow('已变化')
    expect(JSON.parse((await device.getState()).json!).records[0].rawContent.messages[0].text).toBe(
      '离线正文'
    )
  })
})
