import { Capacitor } from '@capacitor/core'
import { Native } from '../src/data/native'
import { buildSeaApiUrl, parseSeaLogUrl } from '../src/data/sea-parser'
import { applyLogFilters } from '../../src/shared/log-filter'
import type { SessionRecord } from '../../src/shared/types'
import type { MobileSnapshot } from '../src/data/types'
import { completeResponseWitness } from './private-search-proof'

declare global {
  interface Window {
    __privateSearchResult?: unknown
    __privateSearchResume?: boolean
    __privateSearchReference?: {
      responses: { linkSha256: string; count: number; digest: string; responseHash: string }[]
      manuals?: { id: string; digest: string }[]
    }
  }
}
class PublicValidationError extends Error {}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new PublicValidationError(message)
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
/** Wait for actual UI completion; failures contain public stage names only. */
async function waitFor<T>(read: () => T, stage: string, timeout = 10000): Promise<NonNullable<T>> {
  const until = performance.now() + timeout
  for (;;) {
    const value = read()
    if (value) return value as NonNullable<T>
    check(performance.now() < until, stage)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
function button(text: string, root: ParentNode = document) {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((node) => node.textContent?.trim() === text && !node.disabled)
}
async function click(text: string, root: ParentNode = document) {
  ;(await waitFor(() => button(text, root), 'Expected public action is unavailable')).click()
  await tick()
}
async function shaText(text: string) {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
const sha = (value: unknown) => shaText(JSON.stringify(value))
type Sample = { operation: string; totalMs: number; responseMs: number; submitMs?:number; mutationMs?:number; nativeCalls: { method: string; milliseconds: number; sourceBytes?: number; originalBytes?: number; phases?: Record<string,number> }[] }
type Capture = { moduleId: string; query: string; rows: { name: string; matches: number; excerpt: string }[] }
const results: Sample[] = [], captures: Capture[] = []
let workerTiming: Record<string, number> | undefined
let workerFailure: string | undefined
const originalPost = Worker.prototype.postMessage
Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
  if (message?.type === 'start' && ['search','search-pipeline'].includes(message.job?.type)) {
    message = { ...message, job: { ...message.job, measureSearch: true } }
    workerTiming = undefined
    workerFailure = undefined
    const observe = (event: MessageEvent) => {
      if (!['done', 'failed'].includes(event.data?.type)) return
      this.removeEventListener('message', observe)
      if (event.data.type === 'done') workerTiming = event.data.result?.timing
      else {
        // Public classifications only; worker errors may contain private fields.
        const message = String(event.data.error)
        workerFailure = /hasOwn/.test(message) ? 'Unsupported worker object API' :
          /投影|projection/i.test(message) ? 'Search projection validation failed' :
          /来源|摘要|长度/.test(message) ? 'Search source proof failed' : 'Search worker rejected the complete input'
      }
    }
    this.addEventListener('message', observe)
  }
  return (originalPost as any).call(this, message, ...rest)
}
const native = Capacitor as unknown as { nativePromise: (plugin: string, method: string, options: any) => Promise<any> }
const original = native.nativePromise
let timedCalls: Sample['nativeCalls'] | undefined
let timedSearchStarted = 0
const nativeCallback = (native as any).nativeCallback
;(native as any).nativeCallback = (plugin:string,method:string,options:any,callback:any) => {
  if(plugin!=='Logbook'||method!=='addListener'||options?.eventName!=='searchSourceChunk')
    return nativeCallback(plugin,method,options,callback)
  return nativeCallback(plugin,method,options,(...args:any[])=>{
    const event=args[0]
    if(timedCalls&&event?.source)timedCalls.push({method:'sealedSearchPart',milliseconds:performance.now()-timedSearchStarted,sourceBytes:event.source.bytes,phases:{index:event.index}})
    callback(...args)
  })
}
let phase = 'prepare', fetched = 0, failed = 0, verified = 0
const witnesses = new Map<string, { count: number; digest: string; responseHash: string }>()
let witnessFailure = false
let allowed = new Set<string>()
const observed = new Set<string>()
native.nativePromise = async (plugin, method, options) => {
  const started = performance.now(), capture = timedCalls
  const reply = await original(plugin, method, method === 'createSearchSource' ? {...options,measureSearch:true} : options)
  capture?.push({ method, milliseconds: performance.now() - started,
    ...(method === 'createSearchSource' ? {sourceBytes:reply.source?.bytes,originalBytes:reply.originalSource?.bytes,phases:reply.searchTiming} : {}) })
  if (plugin === 'Logbook' && method === 'fetchLog') {
    // Evidence failure must never turn a successful production response into a
    // network failure. Finish the normal batch, then reject its test evidence.
    try {
      check(allowed.has(options.url) && !observed.has(options.url), 'Unexpected or duplicate private request')
      observed.add(options.url)
      if (reply.status < 200 || reply.status >= 300) failed++
      else {
        fetched++
        const { rows, payload } = completeResponseWitness(reply.text)
        witnesses.set(options.url, { count: rows.length, digest: await sha(rows), responseHash: await sha(payload) })
      }
    } catch { witnessFailure = true }
  }
  return reply
}
/** Click-to-complete result timing; independent oracle work occurs afterward. */
async function search(moduleId: string, moduleName: string, query: string, repeat: number) {
  let group = Array.from(document.querySelectorAll<HTMLElement>('.module-group')).find((node) =>
    node.querySelector('.module-toggle strong')?.textContent === moduleName)
  check(group, 'Imported module UI is missing')
  if (!group.querySelector('.module-content')) {
    group.querySelector<HTMLButtonElement>('.module-toggle')!.click()
    await tick()
  }
  const area = await waitFor(() => group!.querySelector<HTMLElement>('.module-body-search'), 'Search UI did not open')
  const field = area.querySelector<HTMLInputElement>('input')!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, query)
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
  const submit = area.querySelector<HTMLButtonElement>('button[aria-label="搜索模组正文"]')!
  check(submit && !submit.disabled, 'Submitted search is unavailable')
  const calls: Sample['nativeCalls'] = []
  timedCalls = calls
  let response: number | undefined, mutation: number | undefined, queued = false
  const start = performance.now()
  timedSearchStarted = start
  workerTiming = undefined
  const observer = new MutationObserver(() => {
    if (!queued && area.querySelector('[role="status"]')) {
      queued = true
      mutation = performance.now() - start
      requestAnimationFrame(() => { response = performance.now() - start })
    }
  })
  observer.observe(area, { childList: true, subtree: true, characterData: true })
  try {
    submit.click()
    const submitMs = performance.now() - start
    await waitFor(() => { check(!workerFailure, workerFailure ?? 'Search worker failed'); return /匹配 \d+ 个场次|没有找到匹配正文/.test(area.querySelector('[role="status"]')?.textContent ?? '') }, 'Complete search result timed out', 120000)
    const totalMs = performance.now() - start
    if (response === undefined) await new Promise(requestAnimationFrame)
    check(response !== undefined, 'Search visible response was not observed')
    results.push({ operation: 'private-module-search-' + captures.length + '-repeat-' + repeat, totalMs, responseMs: response, submitMs, mutationMs:mutation, nativeCalls: calls, ...workerTiming && { workerTiming } })
  } finally { timedCalls = undefined; observer.disconnect() }
  const rows: Capture['rows'] = []
  for (;;) {
    for (const node of area.querySelectorAll('.search-result')) {
      const text = node.querySelector('strong')?.textContent ?? ''
      const match = /^(.*) · (\d+) 处$/.exec(text)
      check(match, 'Complete result count is missing')
      rows.push({ name: match[1]!, matches: Number(match[2]), excerpt: node.querySelector('span')?.textContent ?? '' })
    }
    const next = button('下一组场次', area)
    if (!next) break
    next.click(); await tick()
  }
  captures.push({ moduleId, query, rows })
  area.querySelector<HTMLButtonElement>('button[aria-label="清空模组正文搜索"]')!.click()
  await tick()
}
void (async () => {
  try {
    const before = await Native.getOverview(), library = JSON.parse(before.json!) as MobileSnapshot
    const added = library.records.filter((row) => !/^public-io-\d+$/.test(row.id))
    check(library.records.length === 196 && added.length === 118, 'Require the complete proven private table and 78 public originals')
    const online = added.filter((row) => row.sourceType === 'online')
    check(online.length === 114 && added.filter((row) => row.sourceType === 'manual').length === 4, 'Require all 114 online and four manual records')
    allowed = new Set(online.map((row) => buildSeaApiUrl(parseSeaLogUrl(row.link!))))
    check(allowed.size === 114, 'Every private online source must be unique')
    const pending = window.__privateSearchResume ? online.filter((row) => row.status !== 'valid') : online
    const priorFetched = window.__privateSearchResume ? online.length - pending.length : 0
    fetched = priorFetched
    if (window.__privateSearchResume) {
      const references = window.__privateSearchReference?.responses
      check(references?.length === 114, 'The resumed corpus needs all independent full-response references')
      for (const row of online) {
        const hash = await shaText(row.link!), reference = references.find((value) => value.linkSha256 === hash)
        check(reference, 'A complete independent response reference is missing')
        witnesses.set(buildSeaApiUrl(parseSeaLogUrl(row.link!)), reference)
      }
    }
    const moduleIds = new Set(added.map((row) => row.moduleId))
    const modules = library.modules.filter((row) => moduleIds.has(row.id))
    check(modules.length === 3, 'Require the complete three-module corpus')
    phase = 'open-records-tab'
    window.__publicIoStage = phase
    await click('跑团记录')
    phase = 'open-batch-dialog'
    if (pending.length) {
    await click('批量检测')
    const dialog = await waitFor(() => document.querySelector('[aria-label="批量检测"]'), 'Batch fetch UI is missing')
    phase = 'select-private-modules'
    if (window.__privateSearchResume) {
      await click('单链接检测', dialog)
      for (const row of pending) {
        const module = modules.find((value) => value.id === row.moduleId)!
        const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
        const label = Array.from(dialog.querySelectorAll('.check-selector label')).find((node) =>
          normalize(node.querySelector('span')?.textContent ?? '') === normalize(module.name + ' · ' + row.name))
        check(label, 'The failed source selector is missing')
        label.querySelector<HTMLInputElement>('input')!.click(); await tick()
      }
    } else for (const module of modules) {
      const label = Array.from(dialog.querySelectorAll('label')).find((node) => node.querySelector('span')?.textContent === module.name)
      check(label, 'Imported module selector is missing')
      label.querySelector<HTMLInputElement>('input')!.click(); await tick()
    }
    check(new RegExp('链接\\s+' + pending.length + '\\s+条').test(dialog.querySelector('.check-progress')?.textContent ?? ''), 'The actual UI must select precisely the pending online sources')
    phase = 'normal-online-fetch'
    window.__publicIoStage = phase
    await click('开始检测', dialog)
    await waitFor(() => button('检测完毕', dialog), 'Normal online fetch did not commit', 20 * 60 * 1000)
    check(fetched === 114 && failed === 0 && witnesses.size === 114 && !witnessFailure, 'Every real online full body must succeed before search acceptance')
    check(new RegExp('成功\\s+' + pending.length + '\\s+·\\s+失败 0').test(dialog.querySelector('.check-progress')?.textContent ?? ''), 'The full real batch must be saved successfully')
    await click('检测完毕', dialog)
    }
    const saved = await Native.getOverview(), metadata = JSON.parse(saved.json!) as MobileSnapshot
    check(saved.revision === before.revision + (pending.length ? 1 : 0) && online.every((row) => metadata.records.find((value) => value.id === row.id)?.status === 'valid'), 'Full batch must pass one atomic CAS commit')
    phase = 'complete-ui-search'
    window.__publicIoStage = phase
    for (const module of modules) for (const [repeat, query] of ['的', '你', '。'].entries())
      await search(module.id, module.name, query, repeat)
    phase = 'independent-full-content-oracle'
    window.__publicIoStage = phase
    const expected = new Map<Capture, Capture['rows']>(captures.map((capture) => [capture, []]))
    for (const row of [...added].sort((a, b) => a.order - b.order)) {
      const record = JSON.parse((await Native.getRecordContent({ ids: [row.id], expectedRevision: saved.revision })).json).records[0] as SessionRecord
      if (row.sourceType === 'online') {
        const witness = witnesses.get(buildSeaApiUrl(parseSeaLogUrl(row.link!)))
        check(witness && record.rawContent?.responseHash === witness.responseHash && record.rawContent?.messages.length === witness.count && await sha(record.rawContent.messages.map((message) => message.raw)) === witness.digest, 'Saved body must retain every complete original message and field')
        verified++
      } else if (window.__privateSearchResume) {
        const reference = window.__privateSearchReference?.manuals?.find((value) => value.id === row.id)
        check(reference && await sha(record.manualContent) === reference.digest, 'Every original manual body must remain complete')
      }
      const messages = record.rawContent ? applyLogFilters(record.rawContent, metadata.settings.filterPreset)
        : (record.manualContent ?? '').split(/\r\n?|\n/).filter((text) => text.trim()).map((text) => ({ header: '', text }))
      for (const capture of captures.filter((capture) => capture.moduleId === row.moduleId)) {
        let matches = 0, excerpt = ''
        for (const message of messages) {
          const text = message.header + '\n' + message.text
          const positions = [...text.matchAll(new RegExp(capture.query, 'gi'))].map((match) => match.index!)
          if (!matches && positions.length) {
            const start = Math.max(0, positions[0]! - 30), end = Math.min(text.length, positions[0]! + capture.query.length + 60)
            excerpt = (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
          }
          matches += positions.length
        }
        if (matches) expected.get(capture)!.push({ name: record.name, matches, excerpt })
      }
    }
    for (const capture of captures) check(JSON.stringify(capture.rows) === JSON.stringify(expected.get(capture)), 'Every result page, count and full-context excerpt must agree with the complete independent oracle')
    check(results.length === 9 && verified === 114, 'Require every first and repeat, with all online bodies verified')
    window.__privateSearchResult = { passed: results.every((row) => row.totalMs <= 600 && row.responseMs <= 100), results, fetched, failed, verified, priorFetched, normalFetchRequests: observed.size, completeResultOraclePassed: true }
  } catch (error) {
    window.__privateSearchResult = { passed: false, phase, results, fetched, failed, verified,
      error: error instanceof PublicValidationError ? error.message : 'Private validation failed; details withheld' }
  } finally { native.nativePromise = original; Worker.prototype.postMessage = originalPost }
})()
