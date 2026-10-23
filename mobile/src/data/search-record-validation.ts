import { validateBackupRecord } from './backup'
import type { NormalizedLog, SessionRecord } from '../../../src/shared/types'

/** Validate every message/image field with the backup schema's exact rules,
 * borrowing read-only body objects instead of cloning the entire log.
 * @param value One native projection record after complete JSON/proof validation.
 * @returns Normalized record metadata and a validated borrowed body. Never use as a write candidate.
 */
export function validateReadOnlySearchRecord(value: unknown): SessionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return validateBackupRecord(value)
  const { rawContent, ...metadata } = value as Record<string, unknown>
  const record = validateBackupRecord(metadata)
  if (rawContent === undefined) return record
  const log = object(rawContent)
  for (const key of ['title', 'sourceUrl', 'responseHash']) optionalString(log[key])
  finite(log.parserVersion)
  if (!Array.isArray(log.messages)) invalid()
  for (const item of log.messages as unknown[]) {
    const message = object(item)
    for (const key of ['id', 'displayName', 'text', 'type']) requiredString(message[key])
    for (const key of ['timestamp', 'platformAccount']) optionalString(message[key])
    finite(message.order)
    if (typeof message.isDiceCommand !== 'boolean' || typeof message.isOffTopic !== 'boolean' || !Array.isArray(message.images)) invalid()
    for (const item of message.images as unknown[]) {
      const image = object(item); requiredString(image.url); optionalString(image.alt)
    }
  }
  if (record.sourceType === 'online' &&
      ((record.cacheSourceUrl && record.cacheSourceUrl !== record.link) ||
       (log.sourceUrl && log.sourceUrl !== record.link)))
    throw new Error('正文来源与场次链接不匹配。')
  return { ...record, rawContent: log as unknown as NormalizedLog }
}
/** @returns No value; abort the entire read-only result on any semantic failure. */
function invalid(): never { throw new Error('正文搜索记录字段校验失败。') }
/** @param value Unknown JSON value. @returns A non-array JSON object or throws. */
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
/** @param value Required string field. @returns No value after type validation. */
function requiredString(value: unknown): void { if (typeof value !== 'string') invalid() }
/** @param value Optional string field. @returns No value after type validation. */
function optionalString(value: unknown): void { if (value !== undefined) requiredString(value) }
/** @param value Required finite numeric field. @returns No value after type validation. */
function finite(value: unknown): void { if (typeof value !== 'number' || !Number.isFinite(value)) invalid() }
