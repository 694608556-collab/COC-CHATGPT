import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'
import { createBrowserPort } from './browser-port'
import { exampleBackup } from '../data/fixtures'
import { previewBackup } from '../data/backup'

it('导入、普通编辑、来源变化、删除和清空不创建操作前副本，陈旧版本不覆盖', async () => {
  vi.stubGlobal('window', { confirm: () => true })
  const browser = createBrowserPort(crypto.randomUUID())
  try {
    await browser.port.selectArchive()
    const snapshot = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
    await browser.port.commitRestore({ json: JSON.stringify(snapshot), expectedRevision: 0, confirmed: true })
    expect(await browser.documents()).toHaveLength(0)
    snapshot.records[0]!.name = '改名'
    await browser.port.commitEdit({ json: JSON.stringify(snapshot), expectedRevision: 1 })
    expect(await browser.documents()).toHaveLength(0)
    const r = snapshot.records[0]!
    snapshot.records[0] = {
      ...r,
      rawContent: undefined,
      link: undefined,
      sourceType: 'manual',
      manualContent: '公开新正文',
      status: 'manual'
    }
    await browser.port.commitEdit({ json: JSON.stringify(snapshot), expectedRevision: 2 })
    await browser.port.commitAction({
      action: { type: 'delete', kind: 'record', id: r.id },
      expectedRevision: 3
    })
    await browser.port.commitAction({ action: { type: 'clear' }, expectedRevision: 4 })
    expect(await browser.documents()).toHaveLength(0)
    await expect(
      browser.port.commitEdit({ json: JSON.stringify(snapshot), expectedRevision: 4 })
    ).rejects.toThrow('变化')
    expect(JSON.parse((await browser.port.getState()).json!).records).toHaveLength(0)
  } finally {
    await browser.close()
    vi.unstubAllGlobals()
  }
})
