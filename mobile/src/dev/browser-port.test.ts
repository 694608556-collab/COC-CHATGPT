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
