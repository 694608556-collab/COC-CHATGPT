import type { SessionRecord } from '../../../src/shared/types'

/** Already-strict JSON spans only. The schema normalizer may remove unknown
 * fields/add defaults, while raw/manual body values (notably message.raw large
 * numeric tokens) must not be silently rounded by a JSON.parse/stringify trip.
 * At most one bounded record is retained. This is not an input validator.
 */
export function recordJsonWithBodyTokens(record: SessionRecord, original: unknown, json: string): string {
  function space(at: number) {
    while (/[ \t\r\n]/.test(json[at] ?? '') && at < json.length) at++
    return at
  }
  function stringEnd(at: number) {
    if (json[at++] !== '"') throw new Error('正文词元引用无效。')
    while (at < json.length) {
      const char = json[at++]!
      if (char === '\\') at++
      else if (char === '"') return at
    }
    throw new Error('正文词元字符串不完整。')
  }
  function end(start: number): number {
    let at = space(start)
    if (json[at] === '"') return stringEnd(at)
    if (json[at] === '{' || json[at] === '[') {
      let depth = 0
      for (; at < json.length; at++) {
        const char = json[at]
        if (char === '"') at = stringEnd(at) - 1
        else if (char === '{' || char === '[') depth++
        else if ((char === '}' || char === ']') && --depth === 0) return at + 1
      }
      throw new Error('正文词元结构不完整。')
    }
    while (at < json.length && !/[,}\] \t\r\n]/.test(json[at]!)) at++
    return at
  }
  function members(start: number) {
    const values = new Map<string, [number, number]>()
    let at = space(start) + 1
    for (;;) {
      at = space(at)
      if (json[at] === '}') return values
      const keyEnd = stringEnd(at),
        key = JSON.parse(json.slice(at, keyEnd)) as string
      at = space(keyEnd)
      if (json[at++] !== ':') throw new Error('正文词元字段无效。')
      at = space(at)
      const until = end(at)
      values.set(key, [at, until])
      at = space(until)
      if (json[at] === '}') return values
      if (json[at++] !== ',') throw new Error('正文词元字段分隔无效。')
    }
  }
  function same(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true
    if (Array.isArray(a) && Array.isArray(b))
      return a.length === b.length && a.every((value, i) => same(value, b[i]))
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const left = a as Record<string, unknown>,
        right = b as Record<string, unknown>
      const keys = Object.keys(left).filter((key) => left[key] !== undefined)
      return (
        keys.length === Object.keys(right).length &&
        keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && same(left[key], right[key]))
      )
    }
    return false
  }
  function preserve(value: unknown, prior: unknown, span?: [number, number]): string {
    if (!span) return JSON.stringify(value)
    if (same(value, prior)) return json.slice(...span)
    if (Array.isArray(value) && Array.isArray(prior)) {
      let at = space(span[0]) + 1
      return (
        '[' +
        value
          .map((item, index) => {
            at = space(at)
            const until = end(at)
            const result = preserve(item, prior[index], [at, until])
            at = space(until)
            if (json[at] === ',') at++
            return result
          })
          .join(',') +
        ']'
      )
    }
    if (value && prior && typeof value === 'object' && typeof prior === 'object') {
      const fields = members(span[0]),
        previous = prior as Record<string, unknown>
      return (
        '{' +
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .map(([key, item]) => JSON.stringify(key) + ':' + preserve(item, previous[key], fields.get(key)))
          .join(',') +
        '}'
      )
    }
    return JSON.stringify(value)
  }
  const fields = members(0),
    previous = original as Record<string, unknown>
  return (
    '{' +
    Object.entries(record)
      .filter(([, value]) => value !== undefined)
      .map(
        ([key, value]) =>
          JSON.stringify(key) +
          ':' +
          (key === 'rawContent' || key === 'manualContent'
            ? preserve(value, previous[key], fields.get(key))
            : JSON.stringify(value))
      )
      .join(',') +
    '}'
  )
}
