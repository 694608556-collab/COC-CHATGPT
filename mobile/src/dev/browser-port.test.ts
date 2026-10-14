import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserPort } from './browser-port'
import { previewBackup } from '../data/backup'
import { exampleBackup } from '../data/fixtures'
import { encodeBase64 } from '../data/native'

afterEach(() => vi.unstubAllGlobals())
async function setup() {
  vi.stubGlobal('window', { confirm: () => true })
  const name = crypto.randomUUID()
  const browser = createBrowserPort(name)
  await browser.port.selectArchive()
  const json = JSON.stringify(
    (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
  )
  return { browser, name, json }
}
describe('浏览器测试存储事务', () => {
  it('排序不增加专属安全副本，保留正文、重开持久化与过期版本保护', async () => {
    const { browser, json } = await setup()
    const input = JSON.parse(json)
    input.records.push({ ...input.records[0], id: 'second-record', name: '第二场', order: 1 })
    await browser.port.commitRestore({ json: JSON.stringify(input), expectedRevision: 0, confirmed: true })
    const documentsBefore = await browser.documents()
    const result = await browser.port.commitAction({
      action: { type: 'reorder', kind: 'record', id: input.records[0].id, targetId: 'second-record' },
      expectedRevision: 1
    })
    const state = await browser.port.getState()
    expect(JSON.parse(state.json!).records[0].order).toBe(1)
    expect(JSON.parse(state.json!).records[0].rawContent).toEqual(input.records[0].rawContent)
    expect(result.safetyBackup).toBeUndefined()
    expect(await browser.documents()).toEqual(documentsBefore)
    await expect(
      browser.port.commitAction({ action: { type: 'clear' }, expectedRevision: 1 })
    ).rejects.toThrow('变化')
    expect((await browser.port.getState()).json).toBe(state.json)
    await browser.close()
  })
  it('删除仍生成可回读的完整安全副本；跨组排序拒绝且不新增文件', async () => {
    const { browser, json } = await setup()
    const input = JSON.parse(json)
    input.modules.push({ ...input.modules[0], id: 'other-module', name: '另一模组', order: 1 })
    input.records.push({ ...input.records[0], id: 'other-record', moduleId: 'other-module', order: 0 })
    await browser.port.commitRestore({ json: JSON.stringify(input), expectedRevision: 0, confirmed: true })
    const before = await browser.port.getState()
    await expect(
      browser.port.commitAction({
        action: { type: 'reorder', kind: 'record', id: input.records[0].id, targetId: 'other-record' },
        expectedRevision: 1
      })
    ).rejects.toThrow('同一列表')
    expect((await browser.port.getState()).json).toBe(before.json)
    expect(await browser.documents()).toHaveLength(1)
    const result = await browser.port.commitAction({
      action: { type: 'delete', kind: 'record', id: input.records[0].id },
      expectedRevision: 1
    })
    expect(result.safetyBackup).toBeDefined()
    const safety = await browser.port.readDocument({ uri: result.safetyBackup!.uri })
    const restored = await previewBackup(Uint8Array.from(atob(safety.base64), (c) => c.charCodeAt(0)))
    expect(restored.snapshot.records).toEqual(input.records)
    expect(JSON.parse((await browser.port.getState()).json!).records).toHaveLength(1)
    await browser.close()
  })
  it('附件导入和快照在同一事务，坏附件不会改变原状态', async () => {
    const { browser, json } = await setup()
    await expect(
      browser.port.commitRestore({
        json,
        expectedRevision: 0,
        confirmed: true,
        attachments: [{ name: '../bad.txt', mime: 'text/plain', base64: btoa('x') }]
      })
    ).rejects.toThrow('文件名')
    expect((await browser.port.getState()).revision).toBe(0)
    expect(await browser.documents()).toHaveLength(0)
    await browser.port.commitRestore({
      json,
      expectedRevision: 0,
      confirmed: true,
      attachments: [{ name: 'public.txt', mime: 'text/plain', base64: btoa('public') }]
    })
    const files = (await browser.port.listDocuments({ all: true })).documents
    const imported = files.find((f) => f.purpose === 'import')!
    expect((await browser.port.readDocument({ uri: imported.uri })).base64).toBe(btoa('public'))
    await browser.close()
  })
  it('自动备份保留十份，仅轮换自有自动文件；手动和安全副本保留，过期请求拒绝', async () => {
    const { browser, json } = await setup()
    await browser.port.commitRestore({ json, expectedRevision: 0, confirmed: true })
    await browser.port.writeArchive({
      name: 'auto-backup-user.json',
      mime: 'application/json',
      base64: btoa('user file')
    })
    const state = await browser.port.getState()
    for (let i = 0; i < 12; i++)
      await browser.port.automaticBackup({ json: state.json!, expectedRevision: 1 })
    const files = await browser.documents()
    expect(files.filter((f) => f.kind === 'auto')).toHaveLength(10)
    expect(files.some((f) => f.name === 'auto-backup-user.json')).toBe(true)
    expect(files.some((f) => f.name.startsWith('before-restore'))).toBe(true)
    await expect(browser.port.automaticBackup({ json, expectedRevision: 0 })).rejects.toThrow('变化')
    expect(await browser.documents()).toHaveLength(12)
    await browser.close()
  })
  it('首次门禁及取消不会被当作授权成功', async () => {
    vi.stubGlobal('window', { confirm: () => false })
    const browser = createBrowserPort(crypto.randomUUID())
    expect((await browser.port.getState()).archive.valid).toBe(false)
    expect((await browser.port.selectArchive()).cancelled).toBe(true)
    await expect(
      browser.port.writeArchive({
        name: 'x.txt',
        mime: 'text/plain',
        base64: encodeBase64(new Uint8Array([1]))
      })
    ).rejects.toThrow('启用')
    await browser.close()
  })
  it('导入需要确认，安全副本与正文可在重开后读取', async () => {
    const { browser, name, json } = await setup()
    await expect(
      browser.port.commitRestore({
        json,
        expectedRevision: 0,
        confirmed: false
      })
    ).rejects.toThrow('确认')
    await browser.port.commitRestore({
      json,
      expectedRevision: 0,
      confirmed: true
    })
    await browser.port.commitEdit({ json, expectedRevision: 1 })
    const files = await browser.documents()
    expect(files).toHaveLength(2)
    const prior = files.find((f) => f.name.startsWith('before-edit'))!
    expect(
      (await previewBackup(Uint8Array.from(atob(prior.base64), (c) => c.charCodeAt(0)))).snapshot.records
    ).toHaveLength(1)
    await browser.close()
    const reopened = createBrowserPort(name)
    expect((await reopened.port.getState()).revision).toBe(2)
    expect((await reopened.port.getState()).json).toContain('离线正文')
    await reopened.close()
  })
  it('同一版本的并发提交只有一个成功，过期提交不会覆盖数据或新增副本', async () => {
    const { browser, json } = await setup()
    const results = await Promise.allSettled([
      browser.port.commitEdit({ json, expectedRevision: 0 }),
      browser.port.commitEdit({ json, expectedRevision: 0 })
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await browser.port.getState()).revision).toBe(1)
    expect(await browser.documents()).toHaveLength(1)
    await browser.close()
  })
})
