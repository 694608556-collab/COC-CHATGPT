import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserPort } from './browser-port'
import { previewBackup } from '../data/backup'
import { exampleBackup } from '../data/fixtures'
import { createEmptyCharacter } from '../../../src/shared/coc-rules'
import { encodeBase64, decodeBase64 } from '../data/native'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
/** @returns 独立空测试存储和已校验公开快照，不写入真实浏览器数据。 */
async function setup() {
  vi.stubGlobal('window', { confirm: () => true })
  const name = crypto.randomUUID(),
    browser = createBrowserPort(name)
  await browser.port.selectArchive()
  const snapshot = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
  return { browser, name, snapshot, json: JSON.stringify(snapshot) }
}

describe('浏览器测试存储事务：自动备份与数据保存独立', () => {
  it('PDF 取消和失败不发布半成品，成功同名另存且不改变场次、版本或已有文件', async () => {
    const { browser, json } = await setup()
    await browser.port.commitRestore({ json, expectedRevision: 0, confirmed: true })
    const before = await browser.port.getState()
    const original = await browser.port.writeArchive({
      name: 'keep.pdf',
      mime: 'application/pdf',
      base64: encodeBase64(new TextEncoder().encode('EXISTING FILE'))
    })
    const baseline = await browser.documents()
    let token = await browser.port.beginPdfArchive()
    await browser.port.appendPdfArchive({
      id: token.id,
      base64: encodeBase64(new TextEncoder().encode('%PDF-1.4\npartial'))
    })
    await browser.port.cancelPdfArchive(token)
    await browser.port.cancelPdfArchive(token)
    expect(await browser.documents()).toEqual(baseline)
    token = await browser.port.beginPdfArchive()
    await browser.port.appendPdfArchive({
      id: token.id,
      base64: encodeBase64(new TextEncoder().encode('%PDF-1.4\nmissing EOF'))
    })
    await expect(browser.port.finishPdfArchive({ id: token.id, name: 'keep.pdf' })).rejects.toThrow('不完整')
    expect(await browser.documents()).toEqual(baseline)
    token = await browser.port.beginPdfArchive()
    const bytes = new TextEncoder().encode('%PDF-1.4\ncomplete fixture\n%%EOF\n')
    await browser.port.appendPdfArchive({ id: token.id, base64: encodeBase64(bytes) })
    const file = await browser.port.finishPdfArchive({ id: token.id, name: 'keep.pdf' })
    expect(file.name).not.toBe('keep.pdf')
    expect(decodeBase64((await browser.port.readDocument({ uri: file.uri })).base64)).toEqual(bytes)
    expect((await browser.port.readDocument({ uri: original.uri })).base64).toBe(baseline[0]!.base64)
    expect(await browser.port.getState()).toEqual(before)
    expect(await browser.documents()).toHaveLength(2)
    await browser.close()
  })
  it('单实体保存保留其他正文及角色字段，角色改名不改动模组 PC，旧版本拒绝', async () => {
    const { browser, name, snapshot } = await setup()
    const character = createEmptyCharacter({ edition: 7, moduleId: snapshot.modules[0]!.id, name: '原角色' })
    character.weapons = [{ name: '完整武器', damage: '1D6', range: 10 }]
    character.background['自定义背景'] = '保留原文'
    snapshot.characters = [character]
    snapshot.modules[0]!.pairs = [{ pc: character.basic.name, pl: '玩家', characterId: character.id }]
    await browser.port.commitRestore({ json: JSON.stringify(snapshot), expectedRevision: 0, confirmed: true })
    await browser.port.commitEntity({
      edit: { kind: 'character', value: { ...character, basic: { ...character.basic, name: '新角色' } } },
      expectedRevision: 1
    })
    const record = {
      ...snapshot.records[0]!,
      name: '场次改名',
      rawContent: undefined,
      cacheSourceUrl: undefined,
      fetchedAt: undefined
    }
    await browser.port.commitEntity({ edit: { kind: 'record', value: record }, expectedRevision: 2 })
    await browser.close()
    const reopened = createBrowserPort(name)
    const state = await reopened.port.getState(),
      after = JSON.parse(state.json!)
    expect(after.modules).toEqual(snapshot.modules)
    expect(after.characters[0].background).toEqual(character.background)
    expect(after.characters[0].weapons).toEqual(character.weapons)
    expect(after.records[0].rawContent).toEqual(snapshot.records[0]!.rawContent)
    await expect(
      reopened.port.commitEntity({ edit: { kind: 'record', value: record }, expectedRevision: 2 })
    ).rejects.toThrow('变化')
    await expect(
      reopened.port.commitEntity({
        edit: { kind: 'record', value: { ...record, moduleId: 'missing' } },
        expectedRevision: 3
      })
    ).rejects.toThrow('关联')
    expect((await reopened.port.getState()).json).toBe(state.json)
    expect(await reopened.documents()).toHaveLength(0)
    await reopened.close()
  })
  it('备份写入期间可提交新修改，文件固定旧版本，新数据和版本不被完成回调覆盖', async () => {
    const { browser, snapshot, json } = await setup()
    await browser.port.commitRestore({ json, expectedRevision: 0, confirmed: true })
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1800000000000)
    let release!: () => void, captured!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      captured = resolve
    })
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
      captured()
      await gate
      return digest(...args)
    })
    const pending = browser.port.automaticBackup({ expectedRevision: 1 })
    await started
    await browser.port.commitModule({
      value: { ...snapshot.modules[0]!, name: '备份期间修改' },
      expectedRevision: 1
    })
    clock.mockReturnValue(1800000120000)
    release()
    const result = await pending
    expect(result.savedAt).toBe(1800000120000)
    expect(result.revision).toBe(1)
    const state = await browser.port.getState()
    expect(state.revision).toBe(2)
    expect(state.lastAutoBackupRevision).toBe(1)
    expect(JSON.parse(state.json!).modules[0].name).toBe('备份期间修改')
    const file = (await browser.documents())[0]!
    const saved = JSON.parse(new TextDecoder().decode(decodeBase64(file.base64)))
    expect(saved.snapshot.modules[0].name).toBe(snapshot.modules[0]!.name)
    expect(saved.snapshot.records).toEqual(snapshot.records)
    await browser.close()
  })
  it('轻量设置拒绝非法类型、夹带实体和陈旧版本，失败不改变数据或文件', async () => {
    const { browser, json, snapshot } = await setup()
    await browser.port.commitRestore({ json, expectedRevision: 0, confirmed: true })
    const before = await browser.port.getState(),
      settings = snapshot.settings
    for (const invalid of [
      { ...settings, theme: 'unknown' },
      { ...settings, records: [] },
      { ...settings, filterPreset: { ...settings.filterPreset, hideTime: 'true' } },
      { ...settings, autoBackup: { enabled: true, interval: 'idle', retention: 1 } }
    ])
      await expect(
        browser.port.commitSettings({ settings: invalid as typeof settings, expectedRevision: 1 })
      ).rejects.toThrow('不合法')
    await expect(browser.port.commitSettings({ settings, expectedRevision: 0 })).rejects.toThrow('变化')
    expect((await browser.port.getState()).json).toBe(before.json)
    expect((await browser.port.getState()).revision).toBe(1)
    expect(await browser.documents()).toHaveLength(0)
    await browser.close()
  })
  it('设置、模组小请求保留正文和角色，绑定同步，重开持久化且不增加副本', async () => {
    const { browser, name, snapshot } = await setup()
    snapshot.characters.push(createEmptyCharacter({ edition: 7, name: '公开关联角色' }))
    await browser.port.commitRestore({ json: JSON.stringify(snapshot), expectedRevision: 0, confirmed: true })
    const settings = { ...snapshot.settings, theme: 'light' as const }
    await browser.port.commitSettings({ settings, expectedRevision: 1 })
    const value = {
      ...snapshot.modules[0]!,
      name: '小请求改名',
      pairs: [{ pc: '旧名', pl: '公开玩家', characterId: snapshot.characters[0]!.id }]
    }
    await browser.port.commitModule({ value, expectedRevision: 2 })
    expect(await browser.documents()).toHaveLength(0)
    await browser.close()
    const reopened = createBrowserPort(name),
      state = await reopened.port.getState(),
      after = JSON.parse(state.json!)
    expect(after.settings).toEqual(settings)
    expect(after.records).toEqual(snapshot.records)
    expect(after.modules[0].name).toBe(value.name)
    expect(after.modules[0].pairs[0].pc).toBe(value.pairs[0]!.pc)
    expect(after.characters[0].moduleIds).toContain(value.id)
    expect(after.characters[0].skills).toEqual(snapshot.characters[0]!.skills)
    expect((await reopened.port.getStatus()).revision).toBe(3)
    await expect(
      reopened.port.commitModule({ value: { ...value, name: '陈旧' }, expectedRevision: 2 })
    ).rejects.toThrow('变化')
    await expect(
      reopened.port.commitModule({ value: { ...value, name: '' }, expectedRevision: 3 })
    ).rejects.toThrow('名称')
    expect((await reopened.port.getState()).json).toBe(state.json)
    await reopened.close()
  })
  it('批量删除一次提交；失效选择不部分删除，模组和未选正文保留', async () => {
    const { browser, snapshot } = await setup()
    snapshot.records.push({ ...snapshot.records[0]!, id: 'second', order: 1 })
    snapshot.records.push({ ...snapshot.records[0]!, id: 'keep', order: 2 })
    await browser.port.commitRestore({ json: JSON.stringify(snapshot), expectedRevision: 0, confirmed: true })
    const before = await browser.port.getState()
    await expect(
      browser.port.commitAction({
        action: { type: 'delete-records', ids: ['r1', 'missing'] },
        expectedRevision: 1
      })
    ).rejects.toThrow('不存在')
    expect((await browser.port.getState()).json).toBe(before.json)
    await browser.port.commitAction({
      action: { type: 'delete-records', ids: ['r1', 'second'] },
      expectedRevision: 1
    })
    const after = JSON.parse((await browser.port.getState()).json!)
    expect(after.records.map((r: { id: string }) => r.id)).toEqual(['keep'])
    expect(after.records[0].rawContent).toEqual(snapshot.records[2]!.rawContent)
    expect(after.modules).toEqual(snapshot.modules)
    expect(await browser.documents()).toHaveLength(0)
    await browser.close()
  })
  it('排序直接保存最新顺序，重开保留；跨组排序和陈旧提交不覆盖', async () => {
    const { browser, name, snapshot } = await setup()
    snapshot.modules.push({ ...snapshot.modules[0]!, id: 'other-module', order: 1 })
    snapshot.records.push({ ...snapshot.records[0]!, id: 'second', order: 1 })
    snapshot.records.push({ ...snapshot.records[0]!, id: 'other-record', moduleId: 'other-module', order: 0 })
    await browser.port.commitRestore({ json: JSON.stringify(snapshot), expectedRevision: 0, confirmed: true })
    await expect(
      browser.port.commitAction({
        action: { type: 'reorder', kind: 'record', id: 'r1', targetId: 'other-record' },
        expectedRevision: 1
      })
    ).rejects.toThrow('同一列表')
    await browser.port.commitAction({
      action: { type: 'reorder', kind: 'record', id: 'r1', targetId: 'second' },
      expectedRevision: 1
    })
    await browser.close()
    const reopened = createBrowserPort(name),
      state = await reopened.port.getState(),
      after = JSON.parse(state.json!)
    expect(after.records[0].order).toBe(1)
    expect(after.records[0].rawContent).toEqual(snapshot.records[0]!.rawContent)
    await expect(
      reopened.port.commitAction({ action: { type: 'clear' }, expectedRevision: 1 })
    ).rejects.toThrow('变化')
    expect((await reopened.port.getState()).json).toBe(state.json)
    expect(await reopened.documents()).toHaveLength(0)
    await reopened.close()
  })
  it('附件导入和快照同一事务；坏附件或坏 JSON 不改变原状态', async () => {
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
    await expect(browser.port.commitEdit({ json: '{invalid', expectedRevision: 0 })).rejects.toThrow()
    expect((await browser.port.getState()).revision).toBe(0)
    await browser.port.commitRestore({
      json,
      expectedRevision: 0,
      confirmed: true,
      attachments: [{ name: 'public.txt', mime: 'text/plain', base64: btoa('public') }]
    })
    const files = (await browser.port.listDocuments({ all: true })).documents
    expect(files).toHaveLength(1)
    expect((await browser.port.readDocument({ uri: files[0]!.uri })).base64).toBe(btoa('public'))
    await browser.close()
  })
  it('自动备份轮换十份，只删除自有自动文件，手动文件保留', async () => {
    const { browser, json } = await setup()
    await browser.port.commitRestore({ json, expectedRevision: 0, confirmed: true })
    await browser.port.writeArchive({
      name: 'auto-backup-user.json',
      mime: 'application/json',
      base64: btoa('user file')
    })
    for (let i = 0; i < 12; i++) await browser.port.automaticBackup({ expectedRevision: 1 })
    const files = await browser.documents()
    expect(files.filter((f) => f.kind === 'auto')).toHaveLength(10)
    expect(files.find((f) => f.name === 'auto-backup-user.json')!.base64).toBe(btoa('user file'))
    await expect(browser.port.automaticBackup({ json, expectedRevision: 0 })).rejects.toThrow('变化')
    expect(await browser.documents()).toHaveLength(11)
    await browser.close()
  })
  it('首次门禁、取消及未确认导入不会写入或授权', async () => {
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
    await expect(
      browser.port.commitRestore({ json: '{}', expectedRevision: 0, confirmed: false })
    ).rejects.toThrow('确认')
    expect((await browser.port.getState()).revision).toBe(0)
    await browser.close()
  })
  it('同一版本并发提交只有一个成功，失败不覆盖且不产生副本', async () => {
    const { browser, json } = await setup()
    const results = await Promise.allSettled([
      browser.port.commitEdit({ json, expectedRevision: 0 }),
      browser.port.commitEdit({ json, expectedRevision: 0 })
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await browser.port.getState()).revision).toBe(1)
    expect(await browser.documents()).toHaveLength(0)
    await browser.close()
  })
})
