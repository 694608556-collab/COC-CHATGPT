import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { previewNativeTable, confirmNativeTable, previewNativeCoc7 } from './table-stream-client'
import type { NativeTableSource, TableStreamPort } from './table-stream-native'
import { decodeBase64 } from './bytes'
import { parseImportSheet } from '../../../src/shared/table-import'
import { readWorkbookGrid } from '../../../src/shared/table-grid'
import { publicCoc7Bytes, publicCoc7Workbook } from '../../test-fixtures/coc7'
import { previewCoc7Import } from './coc7-import'
import { encodeBase64 } from './bytes'

afterEach(() => vi.unstubAllGlobals())
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const csv =
  '模组名,场次名,海豹链接,手动保存内容,手动保存内容（续1）,跑团日期\n公开团,多行,,"第一行\n😀第二行",末尾,2026/10/22\n公开团,联网,https://log.weizaima.com/?key=public,,,'
function fixture(text: string | Uint8Array = csv) {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text
  vi.stubGlobal('location', new URL('https://localhost/'))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const response = new Response(new Uint8Array(bytes).buffer)
      response.arrayBuffer = async () => {
        throw new Error('whole input read forbidden')
      }
      return response
    })
  )
  const source: NativeTableSource = {
    id: 'public-lease',
    revision: 3,
    fileUri: 'https://localhost/_capacitor_file_/public.csv',
    bytes: bytes.length,
    sha256: hash(bytes),
    name: 'public.csv',
    format: 'csv',
    maximumStageBytes: 128 * 1024 * 1024
  }
  const chunks: Uint8Array[] = [],
    next = { candidate: 0, strings: 0 }
  const port: Required<TableStreamPort> = {
    appendTableStage: vi.fn(
      async ({ id, key, index, base64 }: Parameters<Required<TableStreamPort>['appendTableStage']>[0]) => {
        expect(id).toBe(source.id)
        expect(index).toBe(next[key]++)
        const value = decodeBase64(base64)
        expect(value.length).toBeLessThanOrEqual(262144)
        if (key === 'candidate') chunks.push(value)
      }
    ),
    readTableString: vi.fn(async () => {
      throw new Error('CSV has no SST')
    }),
    finishTablePreview: vi.fn(async ({ id, candidate }) => {
      const all = Buffer.concat(chunks)
      expect(candidate).toEqual({ bytes: all.length, sha256: hash(all) })
      return {
        id,
        revision: 3,
        added: 2,
        updated: 0,
        skipped: 0,
        namesCount: 2,
        warningsCount: 0,
        names: ['多行', '联网'],
        warnings: []
      }
    }),
    readTablePreview: vi.fn(async () => ({ values: [], total: 0 })),
    commitTableStream: vi.fn(async () => ({ revision: 4 })),
    cancelTableStage: vi.fn(async () => {})
  }
  return { source, port, bytes, chunks }
}
it('候选正文与旧解析逐字段一致，预览只有私有分段，确认仅提交一次', async () => {
  const { source, port, bytes, chunks } = fixture()
  const result = await previewNativeTable(port, source, 'records')
  const candidate = Buffer.concat(chunks)
    .toString('utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line.slice(1)).value)
  const grid = readWorkbookGrid(bytes, source.name)
  expect(candidate).toEqual(grid.sheets.flatMap((sheet) => parseImportSheet(sheet.name, sheet.rows)))
  expect(candidate[0].manualContent).toBe('第一行\n😀第二行末尾')
  expect(port.commitTableStream).not.toHaveBeenCalled()
  expect(port.cancelTableStage).not.toHaveBeenCalled()
  expect(await confirmNativeTable(port, result.id)).toEqual({ revision: 4 })
  expect(port.commitTableStream).toHaveBeenCalledExactlyOnceWith({ id: source.id, confirmed: true })
  expect(port.cancelTableStage).toHaveBeenCalledExactlyOnceWith({ id: source.id })
})
it('七版人物卡分块预览与专用旧解析字段一致，保留缺缓存/错误值问题而不写库', async () => {
  const book = publicCoc7Workbook()
  book.Sheets['人物卡']!.U3 = { t: 'n', f: '1+2' }
  book.Sheets['人物卡']!.E10 = { t: 'e', v: 7 }
  const bytes = publicCoc7Bytes(book),
    { source, port } = fixture(bytes)
  source.name = 'public.xlsx'
  source.format = 'xlsx'
  const strings = new Map<number, Uint8Array>(),
    decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''
  port.appendTableStage = vi.fn(async ({ key, base64 }) => {
    expect(key).toBe('strings')
    buffer += decoder.decode(decodeBase64(base64), { stream: true })
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const [index, value] = JSON.parse(buffer.slice(0, newline)) as [number, string]
      strings.set(index, new TextEncoder().encode(value))
      buffer = buffer.slice(newline + 1)
    }
  })
  port.readTableString = vi.fn(async ({ stringIndex, offset }) => {
    const value = strings.get(stringIndex)!
    expect(value).toBeDefined()
    const part = value.subarray(offset, offset + 262144)
    return { base64: encodeBase64(part), bytes: value.length, done: offset + part.length === value.length }
  })
  const actual = await previewNativeCoc7(port, source)
  const expected = previewCoc7Import(bytes, 'public.xlsx')
  // The streaming decoder retains the formula node SheetJS drops when its
  // cache is absent; both still require the same field to be filled in.
  expected.issues.find((issue) => issue.key === 'STR')!.message =
    '力量 STR（人物卡 U3）缺少已保存的公式结果，请在此补填。'
  const stable = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value, (key, item) =>
        ['id', 'createdAt', 'updatedAt'].includes(key) ||
        (key === 'key' && typeof item === 'string' && /^[0-9a-f-]{36}$/.test(item))
          ? undefined
          : item
      )
    )
  expect(stable(actual)).toEqual(stable(expected))
  expect(actual.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: 'STR' }),
      expect.objectContaining({ key: '当前 HP' })
    ])
  )
  expect(port.finishTablePreview).not.toHaveBeenCalled()
  expect(port.commitTableStream).not.toHaveBeenCalled()
  expect(port.cancelTableStage).toHaveBeenCalledExactlyOnceWith({ id: source.id })
})
it('源摘要变化时即使已经暂存也不允许预览和提交，并清理自己的租约', async () => {
  const { source, port } = fixture()
  source.sha256 = '0'.repeat(64)
  await expect(previewNativeTable(port, source, 'records')).rejects.toThrow('摘要')
  expect(port.finishTablePreview).not.toHaveBeenCalled()
  expect(port.commitTableStream).not.toHaveBeenCalled()
  expect(port.cancelTableStage).toHaveBeenCalledExactlyOnceWith({ id: source.id })
})
it('分段ACK后的取消不发布候选，清理完成才返回', async () => {
  const { source, port } = fixture()
  const controller = new AbortController()
  port.appendTableStage = vi.fn(async () => controller.abort())
  await expect(previewNativeTable(port, source, 'records', controller.signal)).rejects.toThrow('取消')
  expect(port.finishTablePreview).not.toHaveBeenCalled()
  expect(port.cancelTableStage).toHaveBeenCalledOnce()
})
it('动态空间预算不足拒绝完整导入，不把截断部分当作成功', async () => {
  const { source, port } = fixture()
  source.maximumStageBytes = 10
  await expect(previewNativeTable(port, source, 'records')).rejects.toThrow(/空间|预算/)
  expect(port.finishTablePreview).not.toHaveBeenCalled()
  expect(port.cancelTableStage).toHaveBeenCalledOnce()
})
it('预览证明错误及原生能力缺失同样释放已选来源', async () => {
  const { source, port } = fixture()
  port.finishTablePreview = vi.fn(async () => ({
    id: source.id,
    revision: 9,
    added: 1,
    updated: 0,
    skipped: 0,
    namesCount: 1,
    warningsCount: 0,
    names: ['错误版本'],
    warnings: []
  }))
  await expect(previewNativeTable(port, source, 'records')).rejects.toThrow('证明')
  expect(port.cancelTableStage).toHaveBeenCalledOnce()
  await expect(
    previewNativeTable({ cancelTableStage: port.cancelTableStage }, source, 'records')
  ).rejects.toThrow('能力')
  expect(port.cancelTableStage).toHaveBeenCalledTimes(2)
})
it('保存后的清理失败仍明确已保存；失败前的清理错误不遮盖CAS原因', async () => {
  const { port } = fixture()
  port.cancelTableStage = vi.fn(async () => {
    throw new Error('cleanup')
  })
  expect(await confirmNativeTable(port, 'one')).toMatchObject({
    revision: 4,
    warning: expect.stringContaining('已保存')
  })
  port.commitTableStream = vi.fn(async () => {
    throw new Error('CAS 已变化')
  })
  await expect(confirmNativeTable(port, 'two')).rejects.toThrow('CAS 已变化 私有暂存清理失败')
})
