import { capacity } from './capacity'
import { StreamSha256 } from './stream-sha256'

const utf8 = new TextEncoder()
export const utf8Size = (text: string) => (/[^\x00-\x7f]/.test(text) ? utf8.encode(text).length : text.length)
export function checkStreamBudget(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('文件处理预算无效。')
}
/** Exact accounting is a protocol requirement, not a product storage quota. */
export function addStreamBytes(current: number, incoming: number): number {
  if (
    !Number.isSafeInteger(current) ||
    current < 0 ||
    !Number.isSafeInteger(incoming) ||
    incoming < 0 ||
    !Number.isSafeInteger(current + incoming)
  )
    throw new Error('文件字节数超出系统可精确计量范围。')
  return current + incoming
}
export function checkStreamCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('备份处理已取消，未发布数据。')
}

class TextValue {
  private parts: string[] = []
  private bytes = 0
  constructor(private maximumBytes: number) {}
  add(text: string) {
    this.bytes = addStreamBytes(this.bytes, utf8Size(text))
    if (this.bytes > this.maximumBytes) throw new Error('正文或字段超过本次实际来源/可用空间。')
    this.parts.push(text)
  }
  text() {
    return this.parts.join('')
  }
}

/** Strict UTF-8/JSON cursor. Retains one bounded value, never the complete root.
 * Duplicate keys (including escaped aliases), trailing data and malformed JSON
 * are rejected before a staging caller is allowed to finalize a preview.
 */
export class StreamJson {
  private iterator: AsyncIterator<Uint8Array>
  private decoder = new TextDecoder('utf-8', { fatal: true })
  private digest = new StreamSha256()
  private buffer = ''
  private offset = 0
  private ended = false
  constructor(
    source: AsyncIterable<Uint8Array>,
    private maximumBytes: number,
    private valueBytes: number,
    private signal?: AbortSignal
  ) {
    checkStreamBudget(maximumBytes)
    checkStreamBudget(valueBytes)
    this.iterator = source[Symbol.asyncIterator]()
  }
  private async fill(): Promise<boolean> {
    checkStreamCancelled(this.signal)
    while (this.offset === this.buffer.length && !this.ended) {
      const next = await this.iterator.next()
      this.offset = 0
      if (next.done) {
        this.ended = true
        this.buffer = this.decoder.decode()
        break
      }
      if (next.value.length > capacity.transferChunkBytes) throw new Error('输入分段超过处理上限。')
      if (this.digest.bytes + next.value.length > this.maximumBytes)
        throw new Error('文件超过本次可用处理空间。')
      this.digest.update(next.value)
      this.buffer = this.decoder.decode(next.value, { stream: true })
    }
    return this.offset < this.buffer.length
  }
  private async peek() {
    return (await this.fill()) ? this.buffer[this.offset]! : ''
  }
  private async take() {
    const value = await this.peek()
    if (!value) throw new Error('JSON 文件不完整。')
    this.offset++
    return value
  }
  private async whitespace() {
    while (/[\x20\t\r\n]/.test(await this.peek()) && (await this.peek())) this.offset++
  }
  private async expect(value: string, out?: TextValue) {
    await this.whitespace()
    if ((await this.take()) !== value) throw new Error('JSON 结构无效。')
    out?.add(value)
  }
  private async string(out: TextValue) {
    if ((await this.take()) !== '"') throw new Error('JSON 字符串无效。')
    out.add('"')
    for (;;) {
      if (!(await this.fill())) throw new Error('JSON 字符串不完整。')
      const pattern = /["\\\x00-\x1f]/g
      pattern.lastIndex = this.offset
      const found = pattern.exec(this.buffer)
      const end = found ? found.index : this.buffer.length
      out.add(this.buffer.slice(this.offset, end))
      this.offset = end
      if (!found) continue
      const char = await this.take()
      out.add(char)
      if (char === '"') return
      if (char !== '\\') throw new Error('JSON 字符串含未转义控制字符。')
      const escape = await this.take()
      out.add(escape)
      if (escape === 'u') {
        for (let i = 0; i < 4; i++) {
          const hex = await this.take()
          if (!/[0-9a-fA-F]/.test(hex)) throw new Error('JSON Unicode 转义无效。')
          out.add(hex)
        }
      } else if (!'"\\/bfnrt'.includes(escape)) throw new Error('JSON 转义无效。')
    }
  }
  async object(each: (key: string) => Promise<void>, out?: TextValue, depth = 0) {
    if (depth > 256) throw new Error('JSON 嵌套超过处理上限。')
    await this.expect('{', out)
    const seen = new Set<string>()
    await this.whitespace()
    if ((await this.peek()) !== '}')
      for (;;) {
        await this.whitespace()
        const key = new TextValue(this.valueBytes)
        await this.string(key)
        const raw = key.text(),
          name = JSON.parse(raw) as string
        if (seen.has(name)) throw new Error('JSON 字段重复。')
        seen.add(name)
        out?.add(raw)
        await this.expect(':', out)
        await this.whitespace()
        await each(name)
        await this.whitespace()
        if ((await this.peek()) !== ',') break
        const comma = await this.take()
        out?.add(comma)
        await this.whitespace()
      }
    await this.expect('}', out)
  }
  async array(each: () => Promise<void>, out?: TextValue) {
    await this.expect('[', out)
    await this.whitespace()
    if ((await this.peek()) !== ']')
      for (;;) {
        await each()
        await this.whitespace()
        if ((await this.peek()) !== ',') break
        const comma = await this.take()
        out?.add(comma)
        await this.whitespace()
      }
    await this.expect(']', out)
  }
  private async value(out: TextValue, depth: number): Promise<void> {
    if (depth > 256) throw new Error('JSON 嵌套超过处理上限。')
    await this.whitespace()
    const char = await this.peek()
    if (char === '{') return this.object(() => this.value(out, depth + 1), out, depth + 1)
    if (char === '[') return this.array(() => this.value(out, depth + 1), out)
    if (char === '"') return this.string(out)
    const token = new TextValue(this.valueBytes)
    for (;;) {
      const part = await this.peek()
      if (!part || /[,}\]\x20\t\r\n]/.test(part)) break
      token.add(await this.take())
    }
    const text = token.text()
    if (!/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)$/.test(text))
      throw new Error('JSON 值无效。')
    out.add(text)
  }
  /** Scans one container per input chunk, retaining strict duplicate-key and depth checks.
   * @param out Complete raw JSON value with its existing operation byte budget.
   * @returns No value; leaves the cursor immediately after this object's/array's closing token.
   */
  private async container(out: TextValue): Promise<void> {
    const frames: Array<{ keys?: Set<string>; expectingKey: boolean; weight: number }> = []
    let quoted = false,
      escaped = false,
      key: TextValue | undefined,
      depth = 0
    for (;;) {
      if (!(await this.fill())) throw new Error('JSON 文件不完整。')
      const start = this.offset
      let keyStart = key ? start : -1
      while (this.offset < this.buffer.length) {
        const at = this.offset++,
          code = this.buffer.charCodeAt(at)
        if (quoted) {
          if (escaped) {
            escaped = false
            continue
          }
          if (code === 92) {
            escaped = true
            continue
          }
          if (code !== 34) continue
          quoted = false
          if (key) {
            key.add(this.buffer.slice(keyStart, this.offset))
            const name = JSON.parse(key.text()) as string,
              frame = frames[frames.length - 1]!
            if (frame.keys!.has(name)) throw new Error('JSON 字段重复。')
            frame.keys!.add(name)
            frame.expectingKey = false
            key = undefined
            keyStart = -1
          }
          continue
        }
        if (code === 125 || code === 93) {
          const frame = frames.pop()
          if (!frame || (code === 125) !== !!frame.keys) throw new Error('JSON 结构无效。')
          depth -= frame.weight
          if (!frames.length) {
            out.add(this.buffer.slice(start, this.offset))
            return
          }
          continue
        }
        if (code === 44) {
          const frame = frames[frames.length - 1]
          if (frame?.keys) frame.expectingKey = true
          continue
        }
        if (code === 58 || code === 32 || code === 9 || code === 10 || code === 13) continue
        const frame = frames[frames.length - 1]
        if (code === 34 && frame?.keys && frame.expectingKey) {
          quoted = true
          key = new TextValue(this.valueBytes)
          keyStart = at
          continue
        }
        // Match the original cursor's two depth steps for an object member,
        // and one for an array element. JSON.parse still checks full grammar.
        if (depth > 256 || (code === 123 && depth + 1 > 256)) throw new Error('JSON 嵌套超过处理上限。')
        if (code === 123 || code === 91) {
          const weight = code === 123 ? 2 : 1
          frames.push({
            ...(code === 123 ? { keys: new Set<string>() } : {}),
            expectingKey: code === 123,
            weight
          })
          depth += weight
        } else if (code === 34) quoted = true
      }
      out.add(this.buffer.slice(start, this.offset))
      if (key) key.add(this.buffer.slice(keyStart, this.offset))
    }
  }
  async readValue(): Promise<unknown> {
    return (await this.readRawValue()).value
  }
  async readRawValue(): Promise<{ value: unknown; json: string }> {
    const out = new TextValue(this.valueBytes)
    await this.whitespace()
    const first = await this.peek()
    if (first === '{' || first === '[') await this.container(out)
    else await this.value(out, 0)
    const json = out.text()
    return { value: JSON.parse(json), json }
  }
  async finish() {
    await this.whitespace()
    if (await this.peek()) throw new Error('JSON 尾部包含多余内容。')
    return { bytes: this.digest.bytes, sha256: this.digest.digest() }
  }
  async close() {
    await this.iterator.return?.()
  }
}
