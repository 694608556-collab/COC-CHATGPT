import { createWorksheetEvents } from './table-worksheet'
import { checkStreamCancelled } from './stream-json'
import type { TableGridStreamOptions } from './table-grid-stream'

export type WorksheetCell = Parameters<NonNullable<TableGridStreamOptions['onCell']>>[0]
export interface Coc7WorksheetRequest { bytes: Uint8Array; name: string; strings: string[] }
export interface Coc7WorksheetProjection {
  canUse(): boolean
  run(request: Coc7WorksheetRequest): Promise<WorksheetCell[] | undefined>
}

/** A bounded, detached native XML tokenizer. The SAME cell validator handles
 * every cell, not just the projected character fields. Unsupported spellings
 * fall back to the complete Worker tokenizer, never to partial validation. */
export async function projectCoc7WorksheetDOM(request: Coc7WorksheetRequest, signal?: AbortSignal): Promise<WorksheetCell[] | undefined> {
  if (typeof DOMParser === 'undefined' || request.bytes.length > 512 * 1024 || request.strings.length > 32768) return
  checkStreamCancelled(signal)
  let weight = 0
  for (const value of request.strings) {
    if (typeof value !== 'string' || (weight += value.length * 2 + 64) > 2 * 1024 * 1024) return
  }
  try {
    const bytes = request.bytes
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
    // Reject declarations BEFORE native parsing can expand entities. Literal
    // declaration text in comments or CDATA remains ordinary cell content.
    for (let at = text.indexOf('<!'); at >= 0; at = text.indexOf('<!', at)) {
      const terminator = text.startsWith('<!--', at) ? '-->' : text.startsWith('<![CDATA[', at) ? ']]>' : undefined
      if (!terminator) return
      const end = text.indexOf(terminator, at + 4)
      if (end < 0) return
      at = end + terminator.length
    }
    const document = new DOMParser().parseFromString(text, 'application/xml')
    if (!document.documentElement || document.getElementsByTagName('parsererror').length) return
    const cells: WorksheetCell[] = []
    const events = createWorksheetEvents({
      readString(index) {
        if (!Number.isSafeInteger(index) || index < 0 || index >= request.strings.length) throw Error('共享字符串索引缺失。')
        return request.strings[index]!
      },
      onRow() {},
      ...(request.name === '人物卡' ? { onCell(cell: WorksheetCell) {
        if (Number(cell.address.match(/\d+$/)?.[0]) <= 95) cells.push(cell)
      } } : {})
    }, request.strings.length, 0, false)
    const frames: Array<{ node: Element; next: ChildNode | null; entered: boolean }> = [{ node: document.documentElement, next: null, entered: false }]
    let visited = 0
    while (frames.length) {
      if (!(visited++ % 128)) checkStreamCancelled(signal)
      const frame = frames[frames.length - 1]!
      if (!frame.entered) {
        if (frames.length > 256) return
        frame.entered = true
        const attrs: Record<string, string> = Object.create(null)
        for (const name of ['r', 't', 'ref']) if (frame.node.hasAttribute(name)) attrs[name] = frame.node.getAttribute(name)!
        const pending = events.start(frame.node.localName, attrs)
        if (pending) await pending
        frame.next = frame.node.firstChild
      }
      const child = frame.next
      if (child) {
        frame.next = child.nextSibling
        if (child.nodeType === 1) frames.push({ node: child as Element, next: null, entered: false })
        else if (child.nodeType === 3 || child.nodeType === 4) {
          const pending = events.text(child.nodeValue ?? '')
          if (pending) await pending
        }
      } else {
        const pending = events.end(frame.node.localName)
        if (pending) await pending
        frames.pop()
      }
    }
    return cells
  } catch {
    // The original streaming validator supplies the compatibility verdict and
    // precise error. No input failure is turned into a successful projection.
    return
  }
}
