import { describe, expect, it } from 'vitest'
import { previewBackup, encodeBackup, encodeArchiveBackup } from './backup'
import { exampleBackup } from './fixtures'
import { zipSync, strToU8 } from 'fflate'

describe('安卓备份校验公共边界', () => {
  it('ZIP 解压总量包含完整正文和清单，不能生成自身恢复器拒绝的备份', async () => {
    const current = (await previewBackup(strToU8(JSON.stringify(exampleBackup())))).snapshot
    const rejected = await encodeArchiveBackup(current, [
      { name: 'public-limit.txt', bytes: new Uint8Array(128 * 1024 * 1024) }
    ]).then(
      () => false,
      (error: Error) => error.message.includes('128')
    )
    expect(rejected).toBe(true)
  }, 20000)
  it('旧备份的首行缩进及深色导出标记被禁用', async () => {
    const payload = exampleBackup()
    payload.settings.filterPreset = { indentFirstLine: true, darkDisplay: true }
    const preview = await previewBackup(strToU8(JSON.stringify(payload)))
    expect(preview.snapshot.settings.filterPreset).toMatchObject({
      indentFirstLine: false,
      darkDisplay: false
    })
  })
  it('ZIP 归档往返包含校验过的附件，数据快照不携带外部 URI', async () => {
    const current = (await previewBackup(strToU8(JSON.stringify(exampleBackup())))).snapshot
    current.settings.autoBackup = { enabled: true, interval: 'weekly', retention: 10 }
    const encoded = await encodeArchiveBackup(current, [{ name: '公开正文.txt', bytes: strToU8('公开正文') }])
    const preview = await previewBackup(encoded)
    expect(preview.attachments).toHaveLength(1)
    expect(new TextDecoder().decode(preview.attachments![0]!.bytes)).toBe('公开正文')
    expect(preview.snapshot.settings.autoBackup?.enabled).toBe(true)
    expect(JSON.stringify(preview.snapshot)).not.toContain('archives/')
  })
  it('不接受未知版本，也不静默转换为可导入数据', async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ schemaVersion: 99, modules: [], records: [], characters: [] })
    )
    await expect(previewBackup(bytes)).rejects.toThrow('版本')
  })
  it('保留离线正文，但不给安卓存储携带电脑专属模块和旧保存路径', async () => {
    const preview = await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))
    expect(preview).toMatchObject({
      snapshot: { records: [{ rawContent: { messages: [{ text: '离线正文' }] } }] },
      offlineRecords: 1
    })
    expect(JSON.stringify(preview)).not.toMatch(/电脑专属|old-path/)
  })
  it('拒绝重复实体标识，不能在覆盖时静默丢掉其中一项', async () => {
    const payload = exampleBackup()
    payload.records.push({ ...payload.records[0]! })
    await expect(previewBackup(new TextEncoder().encode(JSON.stringify(payload)))).rejects.toThrow('重复')
  })
  it('拒绝附件内容与清单摘要不符的 ZIP', async () => {
    const payload = {
      ...exampleBackup(),
      manifest: [
        { archivePath: 'example.txt', zipPath: 'archives/example.txt', size: 3, hash: '0'.repeat(64) }
      ]
    }
    const bytes = zipSync({
      'backup.json': strToU8(JSON.stringify(payload)),
      'archives/example.txt': strToU8('abc')
    })
    await expect(previewBackup(bytes)).rejects.toThrow('校验')
  })
  it('安卓备份明确标记来源，并可带正文往返；旧电脑版不能误当普通整库备份', async () => {
    const first = await previewBackup(strToU8(JSON.stringify(exampleBackup())))
    const bytes = encodeBackup(first.snapshot)
    const envelope = JSON.parse(new TextDecoder().decode(bytes))
    expect(envelope).toMatchObject({ format: 'coc.logbook.android', formatVersion: 1 })
    expect(envelope.schemaVersion).toBeUndefined()
    expect((await previewBackup(bytes)).snapshot.records[0]?.rawContent?.messages[0]?.text).toBe('离线正文')
  })
  it('场次引用不存在的模组时拒绝导入', async () => {
    const payload = exampleBackup()
    payload.records[0]!.moduleId = 'missing'
    await expect(previewBackup(strToU8(JSON.stringify(payload)))).rejects.toThrow('关联')
  })
  it('正文缓存来源与场次链接不匹配时拒绝导入', async () => {
    const source = exampleBackup()
    const payload = {
      ...source,
      records: source.records.map((r) => ({
        ...r,
        cacheSourceUrl: 'https://log.weizaima.com/?key=another-example'
      }))
    }
    await expect(previewBackup(strToU8(JSON.stringify(payload)))).rejects.toThrow('来源')
  })
})
