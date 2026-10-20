import { expect, it, vi } from 'vitest'
import { searchSample } from '../dev/sample'

it('旧WebView工作线程缺少randomUUID时仍可解析表格，UUID使用系统随机源', async () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto)
  vi.stubGlobal('crypto', { getRandomValues })
  vi.resetModules()
  try {
    await import('./snapshot-worker-compat')
    const id = crypto.randomUUID()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const { performSnapshotJob } = await import('./snapshot-job')
    const bytes = new TextEncoder().encode('模组名,场次名,手动保存内容\n公开兼容模组,公开兼容场次,保留正文')
    const result = await performSnapshotJob({
      type: 'table-import',
      snapshot: searchSample(),
      base64: Buffer.from(bytes).toString('base64'),
      name: 'public-worker.csv',
      kind: 'records'
    })
    expect(result).toMatchObject({ names: ['公开兼容模组 / 公开兼容场次'] })
  } finally {
    vi.unstubAllGlobals()
    vi.resetModules()
  }
})
