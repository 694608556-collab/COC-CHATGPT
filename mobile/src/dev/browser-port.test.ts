import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserPort } from './browser-port'
import { previewBackup } from '../data/backup'
import { exampleBackup } from '../data/fixtures'
import { encodeBase64 } from '../data/native'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
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
  it('轻量设置拒绝非法类型和夹带实体，失败不改变数据或归档', async () => {
    const { browser, json } = await setup()
    await browser.port.commitRestore({ json, expectedRevision: 0, confirmed: true })
    const before = await browser.port.getState()
    const settings = JSON.parse(json).settings
    for (const invalid of [
      { ...settings, theme: 'unknown' },
      { ...settings, records: [] },
      { ...settings, filterPreset: { ...settings.filterPreset, hideTime: 'true' } },
      { ...settings, autoBackup: { enabled: true, interval: 'idle', retention: 1 } }
    ]) {
      await expect(browser.port.commitSettings({ settings: invalid, expectedRevision: 1 })).rejects.toThrow(
        '不合法'
      )
      expect((await browser.port.getState()).json).toBe(before.json)
      expect((await browser.port.getState()).revision).toBe(1)
      expect(await browser.documents()).toHaveLength(1)
    }
    await browser.close()
  })
  it('只提交设置不改场次正文或归档，重开保留设置并拒绝陈旧版本', async () => {
    const { browser, name, json } = await setup()
    await browser.port.commitRestore({ json, expectedRevision: 0, confirmed: true })
    const before = JSON.parse((await browser.port.getState()).json!)
    const settings = { ...before.settings, theme: 'light' }
    const result = await browser.port.commitSettings({ settings, expectedRevision: 1 })
    expect(result.revision).toBe(2)
    expect(await browser.documents()).toHaveLength(1)
    await browser.close()
    const reopened = createBrowserPort(name)
    const after = JSON.parse((await reopened.port.getState()).json!)
    expect(after.settings).toEqual(settings)
    expect(after.modules).toEqual(before.modules)
    expect(after.records).toEqual(before.records)
    expect(after.characters).toEqual(before.characters)
    await expect(
      reopened.port.commitSettings({ settings: before.settings, expectedRevision: 1 })
    ).rejects.toThrow('变化')
    expect((await reopened.port.getState()).revision).toBe(2)
    await reopened.close()
  })
  it('设置无全量副本，普通编辑十分钟合并并跨重开保留窗口，过期版本不能写入', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1800000000000)
    const { browser, name, json } = await setup()
    await browser.port.commitRestore({ json, expectedRevision: 0, confirmed: true })
    const next = JSON.parse(json)
    next.settings.theme = 'light'
    const settings = await browser.port.commitEdit({ json: JSON.stringify(next), expectedRevision: 1 })
    expect(settings.safetyBackup).toBeUndefined()
    expect(await browser.documents()).toHaveLength(1)
    next.records[0].name = '第一次普通编辑'
    const first = await browser.port.commitEdit({ json: JSON.stringify(next), expectedRevision: 2 })
    expect(first.safetyBackup).toBeDefined()
    next.records[0].name = '窗口内第二次编辑'
    const second = await browser.port.commitEdit({ json: JSON.stringify(next), expectedRevision: 3 })
    expect(second.safetyBackup).toBeUndefined()
    expect(await browser.documents()).toHaveLength(2)
    await browser.close()
    const reopened = createBrowserPort(name)
    next.records[0].name = '重开后的窗口内编辑'
    await reopened.port.commitEdit({ json: JSON.stringify(next), expectedRevision: 4 })
    expect(await reopened.documents()).toHaveLength(2)
    await expect(reopened.port.commitEdit({ json, expectedRevision: 4 })).rejects.toThrow('变化')
    expect(JSON.parse((await reopened.port.getState()).json!).records[0].name).toBe('重开后的窗口内编辑')
    clock.mockReturnValue(1800000600000)
    next.records[0].name = '满十分钟后编辑'
    const expired = await reopened.port.commitEdit({ json: JSON.stringify(next), expectedRevision: 5 })
    expect(expired.safetyBackup).toBeDefined()
    expect(await reopened.documents()).toHaveLength(3)
    const safety = await reopened.port.readDocument({ uri: expired.safetyBackup!.uri })
    const previous = await previewBackup(Uint8Array.from(atob(safety.base64), (c) => c.charCodeAt(0)))
    expect(previous.snapshot.records[0]!.name).toBe('重开后的窗口内编辑')
    expect(previous.snapshot.records[0]!.rawContent).toEqual(next.records[0].rawContent)
    await reopened.close()
  })
  it('批量删除一次提交并保留完整安全副本，失效选择或过期版本不删除任何数据', async () => {
    const { browser, json } = await setup()
    const input = JSON.parse(json)
    input.records.push({ ...input.records[0], id: 'batch-second', order: 1 })
    input.records.push({ ...input.records[0], id: 'batch-keep', order: 2 })
    await browser.port.commitRestore({ json: JSON.stringify(input), expectedRevision: 0, confirmed: true })
    const before = await browser.port.getState()
    await expect(
      browser.port.commitAction({
        action: { type: 'delete-records', ids: ['r1', 'missing'] },
        expectedRevision: 1
      })
    ).rejects.toThrow('不存在')
    expect((await browser.port.getState()).json).toBe(before.json)
    expect(await browser.documents()).toHaveLength(1)
    const result = await browser.port.commitAction({
      action: { type: 'delete-records', ids: ['r1', 'batch-second'] },
      expectedRevision: 1
    })
    const after = await browser.port.getState()
    expect(after.revision).toBe(2)
    expect(JSON.parse(after.json!).records.map((r: { id: string }) => r.id)).toEqual(['batch-keep'])
    expect(JSON.parse(after.json!).modules).toEqual(input.modules)
    expect(await browser.documents()).toHaveLength(2)
    const safety = await browser.port.readDocument({ uri: result.safetyBackup!.uri })
    const restored = await previewBackup(Uint8Array.from(atob(safety.base64), (c) => c.charCodeAt(0)))
    expect(restored.snapshot.records).toEqual(input.records)
    await expect(
      browser.port.commitAction({
        action: { type: 'delete-records', ids: ['batch-keep'] },
        expectedRevision: 1
      })
    ).rejects.toThrow('变化')
    expect((await browser.port.getState()).json).toBe(after.json)
    expect(await browser.documents()).toHaveLength(2)
    await browser.close()
  })
  it('保护窗口内更换来源和删除仍逐次保留完整副本，副本生成失败不提交也不消耗窗口', async () => {
    const { browser, json } = await setup()
    await browser.port.commitRestore({ json, expectedRevision: 0, confirmed: true })
    const next = JSON.parse(json)
    next.records[0].name = '建立普通编辑窗口'
    const failure = vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('副本生成失败'))
    await expect(
      browser.port.commitEdit({ json: JSON.stringify(next), expectedRevision: 1 })
    ).rejects.toThrow('副本生成失败')
    expect((await browser.port.getState()).revision).toBe(1)
    expect(await browser.documents()).toHaveLength(1)
    failure.mockRestore()
    await browser.port.commitEdit({ json: JSON.stringify(next), expectedRevision: 1 })
    next.records[0].name = '窗口内改名'
    await browser.port.commitEdit({ json: JSON.stringify(next), expectedRevision: 2 })
    expect(await browser.documents()).toHaveLength(2)
    delete next.records[0].rawContent
    delete next.records[0].link
    next.records[0].sourceType = 'manual'
    next.records[0].manualContent = '新来源公开正文'
    next.records[0].status = 'manual'
    const changed = await browser.port.commitEdit({ json: JSON.stringify(next), expectedRevision: 3 })
    expect(changed.safetyBackup).toBeDefined()
    const read = await browser.port.readDocument({ uri: changed.safetyBackup!.uri })
    const safety = await previewBackup(Uint8Array.from(atob(read.base64), (c) => c.charCodeAt(0)))
    expect(safety.snapshot.records[0]!.rawContent!.messages[0]!.text).toBe('离线正文')
    const removed = await browser.port.commitAction({
      action: { type: 'delete-records', ids: ['r1'] },
      expectedRevision: 4
    })
    expect(removed.safetyBackup).toBeDefined()
    expect(await browser.documents()).toHaveLength(4)
    expect(JSON.parse((await browser.port.getState()).json!).records).toEqual([])
    await browser.close()
  })
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
    const edited = JSON.parse(json)
    edited.records[0].name = '实际修改名称'
    await browser.port.commitEdit({ json: JSON.stringify(edited), expectedRevision: 1 })
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
