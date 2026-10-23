import { unzlibSync } from 'fflate'
import { decodeBase64 } from '../src/data/bytes'

function locate(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((row) => row && typeof row === 'object')
  if (!value || typeof value !== 'object') return []
  for (const key of ['logs', 'messages', 'items', 'records', 'logList', 'data']) {
    const rows = locate((value as Record<string, unknown>)[key])
    if (rows.length) return rows
  }
  return []
}
/** Independent test witness for the real HTTP protocol, including compressed
 * data envelopes. No network or persistence, and no normalized-field projection.
 * @param text Complete actual response JSON. @returns Full payload and original rows.
 */
export function completeResponseWitness(text: string) {
  let payload = JSON.parse(text)
  if (payload && typeof payload === 'object' && typeof payload.data === 'string') {
    const decoded = unzlibSync(decodeBase64(payload.data))
    payload = { ...payload, ...JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded)) }
  }
  const rows = locate(payload)
  if (!rows.length) throw Error('Complete response witness contains no messages')
  return { payload, rows }
}
