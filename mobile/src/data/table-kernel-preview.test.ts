import { afterEach, expect, it, vi } from 'vitest'
import { projectKernelCoc7Sheet } from './table-kernel-preview'
import { previewNativeCoc7 } from './table-stream-client'
import { publicCoc7Workbook } from '../../test-fixtures/coc7'
import { previewCoc7Sheet } from './coc7-import'
import { characterDraftProofText } from '../../tests/character-draft-proof'
import * as XLSX from 'xlsx'
import type { NativeTableSource, TableStreamPort } from './table-stream-native'
afterEach(() => vi.unstubAllGlobals())

const token = (address: string, type = '', raw = '', formula = '', hasFormula = false) => ({ address, type, raw, inlineText: '', formula, hasFormula })
const payload = () => ({ version: 1, supported: true, stringCount: 1, strings: { 0: '完整_x000D_\n正文😀' }, rows: [{ index: 0, cells: [token('A1','s','0'),token('B1','','42'),token('C1','e','#VALUE!'),token('D1','','','',true),token('E1','str','缓存','_xlfn.TEXT(1)',true)] }] })

it('原生投影仍由原单元格校验器恢复完整字符串、错误、公式和缺缓存语义', async () => {
  const sheet = await projectKernelCoc7Sheet(payload())
  expect(sheet).toEqual({ A1:{t:'s',v:'完整\r\n正文😀'},B1:{t:'n',v:42},C1:{t:'e',v:15},D1:{t:'n',f:'SAVED_FORMULA'},E1:{t:'s',v:'缓存',f:'TEXT(1)'} })
})

function nativeCase() {
  const sheet = publicCoc7Workbook().Sheets['人物卡']!, rows = new Map<number, ReturnType<typeof token>[]>()
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith('!')) continue
    const index = XLSX.utils.decode_cell(address).r
    if (index >= 95) continue
    const cells = rows.get(index) ?? []
    cells.push(token(address, cell.t === 's' ? 'str' : cell.t ?? '', cell.v === undefined ? '' : String(cell.v), cell.f ?? '', !!cell.f))
    rows.set(index, cells)
  }
  for (const cells of rows.values()) cells.sort((a,b) => XLSX.utils.decode_cell(a.address).c - XLSX.utils.decode_cell(b.address).c)
  const source: NativeTableSource = { id:'public-owner',revision:7,fileUri:'file:///private/source.part',name:'public.xlsx',format:'xlsx',bytes:42,sha256:'a'.repeat(64),maximumStageBytes:1024,
    coc7Kernel:{source:{bytes:42,sha256:'a'.repeat(64)},payload:{version:1,supported:true,stringCount:0,strings:{},rows:[...rows].map(([index,cells])=>({index,cells}))}} }
  const port: Required<TableStreamPort> = {
    appendTableStage:vi.fn(),readTableString:vi.fn(),finishTablePreview:vi.fn(),readTablePreview:vi.fn(),commitTableStream:vi.fn(),cancelTableStage:vi.fn(async()=>{})
  }
  return { source,port,sheet }
}

it('已绑定完整来源的原生结果保持全部草稿字段，仅释放本次私有暂存，不再次读取或提交', async () => {
  const { source,port,sheet } = nativeCase(), fetch = vi.fn()
  vi.stubGlobal('fetch',fetch)
  const result = await previewNativeCoc7(port,source)
  expect(characterDraftProofText(result)).toBe(characterDraftProofText(previewCoc7Sheet(sheet)))
  expect(fetch).not.toHaveBeenCalled();expect(port.appendTableStage).not.toHaveBeenCalled();expect(port.commitTableStream).not.toHaveBeenCalled()
  expect(port.cancelTableStage).toHaveBeenCalledExactlyOnceWith({id:source.id,requireCurrent:true})
})

it('只读快照必须在展示前通过活跃租约、当前授权及版本的原生复查，不能复用已失效结果', async () => {
  const {source,port}=nativeCase()
  port.cancelTableStage=vi.fn(async options=>{if(options.requireCurrent)throw Error('租约、授权或版本已失效')})
  await expect(previewNativeCoc7(port,source)).rejects.toThrow(/已失效/)
  expect(port.cancelTableStage).toHaveBeenNthCalledWith(1,{id:source.id,requireCurrent:true})
  expect(port.cancelTableStage).toHaveBeenNthCalledWith(2,{id:source.id})
  expect(port.commitTableStream).not.toHaveBeenCalled()
})

it('来源证明不一致和已取消操作不能使用原生草稿，并且清理本次暂存', async () => {
  const first = nativeCase();first.source.coc7Kernel!.source.sha256='b'.repeat(64)
  await expect(previewNativeCoc7(first.port,first.source)).rejects.toThrow(/完整证明/)
  expect(first.port.cancelTableStage).toHaveBeenCalledExactlyOnceWith({id:first.source.id})
  const second = nativeCase(), controller=new AbortController();controller.abort()
  await expect(previewNativeCoc7(second.port,second.source,controller.signal)).rejects.toThrow(/取消/)
  expect(second.port.cancelTableStage).toHaveBeenCalledExactlyOnceWith({id:second.source.id})
  expect(second.port.commitTableStream).not.toHaveBeenCalled()
})

it('不完整原生协议、缺SST、重复坐标、行不匹配、NaN和未知类型不能生成草稿', async () => {
  for (const modify of [
    (p: any) => { p.version = 2 }, (p: any) => { p.supported = false },
    (p: any) => { p.strings = {} }, (p: any) => { p.rows[0].cells[1].address = 'A1' },
    (p: any) => { p.rows[0].cells[1].address = 'B2' },
    (p: any) => { p.rows[0].cells[1].raw = 'NaN' },
    (p: any) => { p.rows[0].cells[1].type = 'unknown' }
  ]) {
    const next = payload(); modify(next)
    await expect(projectKernelCoc7Sheet(next)).rejects.toThrow()
  }
})

it('完整检查协议的每个基本类型与整数范围，包括最后一个单元格；不能以省略检查优化', async () => {
  const mutations: Array<(p:any)=>void> = [
    p=>{p.stringCount=Infinity},p=>{p.stringCount=-1},p=>{p.stringCount=0.5},p=>{p.stringCount=Number.MAX_SAFE_INTEGER+1},
    p=>{p.strings=[]},p=>{p.strings[0]=42},p=>{p.rows={}},p=>{p.rows[0].index=-1},p=>{p.rows[0].index=95},p=>{p.rows[0].index=0.5},p=>{p.rows[0].cells=null}
  ]
  for (const field of ['address','type','raw','inlineText','formula','hasFormula']) mutations.push(p=>{p.rows[0].cells.at(-1)[field]=field==='hasFormula'?'true':42})
  for (const mutate of mutations) {const next=payload();mutate(next);await expect(projectKernelCoc7Sheet(next)).rejects.toThrow()}
})

it('紧凑传输保留每个完整值、公式和错误，并拒绝长度及每项类型损坏', async () => {
  const compact = () => {
    const p = payload()
    return { ...p, compact: true, rows: p.rows.map(row=>({...row,cells:row.cells.map(c=>[c.address,c.type,c.raw,c.inlineText,c.formula,c.hasFormula] as unknown[])})) }
  }
  expect(await projectKernelCoc7Sheet(compact())).toEqual(await projectKernelCoc7Sheet(payload()))
  for (let index=0;index<6;index++) {const p=compact();p.rows[0]!.cells.at(-1)![index]=index===5?'true':42;await expect(projectKernelCoc7Sheet(p)).rejects.toThrow()}
  for (const extra of [false,true]) {const p=compact();if(extra)p.rows[0]!.cells.at(-1)!.push('extra');else p.rows[0]!.cells.at(-1)!.pop();await expect(projectKernelCoc7Sheet(p)).rejects.toThrow()}
})
