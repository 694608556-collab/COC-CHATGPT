import { describe, expect, it } from 'vitest'
import { zlibSync } from 'fflate'
import { fetchRecord } from './network'
import { exampleBackup } from './fixtures'
import { previewBackup } from './backup'
import type { LogbookPort } from './native'
const record = async () =>
  (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot.records[0]!
describe('海豹联网数据契约', () => {
  it('按桌面协议解压 data、识别正文，人工日期保留', async () => {
    const source = { messages: [{ nickname: '测试', content: '网络正文', time: '2026-10-13T00:00:00Z' }] }
    const payload = {
      data: Buffer.from(zlibSync(new TextEncoder().encode(JSON.stringify(source)))).toString('base64')
    }
    const port = {
      fetchLog: async ({ url }: { url: string }) => {
        expect(url).toContain('https://dice-api.weizaima.com/dice/api/load_data?key=public-example')
        return { status: 200, url, text: JSON.stringify(payload) }
      }
    } satisfies Pick<LogbookPort, 'fetchLog'>
    const next = await fetchRecord(port, {
      ...(await record()),
      playDate: '2020-01-01',
      dateSource: 'manual'
    })
    expect(next.rawContent?.messages[0]?.text).toBe('网络正文')
    expect(next.playDate).toBe('2020-01-01')
    expect(next.rawContent?.responseHash).toHaveLength(64)
  })
  it('超时、无效响应与服务失败保留已存正文；拒绝异域跳转', async () => {
    const current = await record()
    for (const port of [
      {
        fetchLog: async () => {
          throw new Error('timeout')
        }
      },
      { fetchLog: async () => ({ status: 503, url: 'https://dice-api.weizaima.com/', text: '' }) },
      { fetchLog: async () => ({ status: 200, url: 'https://dice-api.weizaima.com/', text: 'bad-json' }) }
    ]) {
      const next = await fetchRecord(port, current)
      expect(next.status).toBe('fetch_failed')
      expect(next.rawContent).toEqual(current.rawContent)
    }
    await expect(
      fetchRecord(
        { fetchLog: async () => ({ status: 200, url: 'https://other.invalid/', text: '{}' }) },
        current
      )
    ).rejects.toThrow('不受信任')
  })
})
