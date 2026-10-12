import { z } from 'zod'
import { unzipSync } from 'fflate'
import { DEFAULT_FILTER_PRESET } from '../../../src/shared/types'
import type { ImportPreview, MobileSnapshot } from './types'

const string = z.string()
const number = z.number().finite()
const optionalString = string.optional()
const moduleSchema = z.object({
  id: string.min(1),
  name: string,
  playStatus: z.enum(['finished', 'running', 'not_started']).default('not_started'),
  kps: z.array(string),
  pairs: z.array(z.object({ pc: string, pl: string, characterId: optionalString })),
  order: number,
  collapsed: z.boolean(),
  createdAt: string,
  updatedAt: string
})
const logSchema = z.object({
  title: optionalString,
  sourceUrl: optionalString,
  responseHash: optionalString,
  parserVersion: number,
  messages: z.array(
    z.object({
      id: string,
      order: number,
      timestamp: optionalString,
      displayName: string,
      platformAccount: optionalString,
      text: string,
      type: string,
      isDiceCommand: z.boolean(),
      isOffTopic: z.boolean(),
      images: z.array(z.object({ url: string, alt: optionalString })),
      raw: z.unknown().optional()
    })
  )
})
const recordSchema = z.object({
  id: string.min(1),
  moduleId: string.min(1),
  name: string,
  sequenceNo: number.default(0),
  link: optionalString,
  sourceType: z.enum(['online', 'manual']),
  status: z.enum(['pending', 'valid', 'invalid', 'fetch_failed', 'manual']),
  previousStatus: z.enum(['pending', 'valid', 'invalid', 'fetch_failed', 'manual']).optional(),
  playDate: optionalString,
  dateSource: z.enum(['parsed', 'manual', 'none']),
  fetchedAt: optionalString,
  rawContent: logSchema.optional(),
  manualContent: optionalString,
  cacheSourceUrl: optionalString,
  lastError: optionalString,
  order: number,
  createdAt: string,
  updatedAt: string
})
const characterSchema = z.object({
  id: string.min(1),
  moduleId: optionalString,
  moduleIds: z.array(string).default([]),
  edition: z.union([z.literal(6), z.literal(7)]),
  basic: z.object({
    name: string,
    occupation: string,
    age: string,
    gender: string,
    birthplace: string,
    residence: string
  }),
  attrs: z.object({
    STR: number,
    CON: number,
    SIZ: number,
    DEX: number,
    APP: number,
    INT: number,
    POW: number,
    EDU: number
  }),
  editionSnapshots: z.record(string, z.record(string, number)).default({}),
  derived: z.object({
    hpCurrent: number,
    mpCurrent: number,
    sanCurrent: number,
    luck6: number.optional(),
    luck7: number.optional(),
    db: string
  }),
  occupationFormula: string,
  occupationPointOverride: number.optional(),
  skills: z.array(
    z.object({
      id: string,
      name: string,
      base: number,
      occupation: number,
      interest: number,
      growth: number,
      hidden: z.boolean().optional(),
      builtIn: z.boolean().optional(),
      mappingState: z.enum(['ok', 'review', 'unmapped']).optional()
    })
  ),
  weapons: z.array(z.record(string, z.union([string, number]))),
  items: z.array(string),
  background: z.record(string, string),
  story: string,
  createdAt: string,
  updatedAt: string
})
const filterSchema = z.object(
  Object.fromEntries(Object.keys(DEFAULT_FILTER_PRESET).map((key) => [key, z.boolean().optional()]))
)
const payloadSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  exportedAt: string,
  modules: z.array(moduleSchema),
  records: z.array(recordSchema),
  characters: z.array(characterSchema),
  settings: z
    .object({ theme: z.enum(['light', 'dark']).optional(), filterPreset: filterSchema.optional() })
    .optional()
})

/**
 * 校验用户选择的 JSON 备份，构造仅含安卓业务的数据；不写数据库。
 * @param bytes - 原始备份 UTF-8 字节。
 * @returns 已剔除电脑专属数据的预览及正文数量。
 * @throws 版本、实体结构或 JSON 不合法时拒绝导入。
 */
export async function previewBackup(bytes: Uint8Array): Promise<ImportPreview> {
  if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw new Error('备份大小无效，首阶段上限为 64 MB。')
  let input: unknown
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const seen = new Set<string>()
    let total = 0
    const files = unzipSync(bytes, {
      filter: (info) => {
        if (
          !info.name ||
          info.name.includes('\\') ||
          info.name.includes('\0') ||
          info.name.startsWith('/') ||
          /^[A-Za-z]:/.test(info.name) ||
          info.name.split('/').includes('..')
        )
          throw new Error('ZIP 路径校验失败。')
        if (seen.has(info.name)) throw new Error('ZIP 条目重复，校验失败。')
        seen.add(info.name)
        total += info.originalSize
        if (total > 128 * 1024 * 1024 || seen.size > 2000) throw new Error('ZIP 解压大小校验失败。')
        return !info.name.endsWith('/')
      }
    })
    const data = files['backup.json']
    if (!data) throw new Error('ZIP 校验失败：缺少 backup.json。')
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))
    const manifests = z
      .object({
        manifest: z.array(z.object({ zipPath: string, size: number, hash: string })).optional(),
        noteImages: z.array(z.object({ zipPath: string, size: number, hash: string })).optional()
      })
      .parse(input)
    for (const item of [...(manifests.manifest ?? []), ...(manifests.noteImages ?? [])]) {
      const file = files[item.zipPath]
      if (!file || file.length !== item.size) throw new Error('ZIP 文件大小或存在性校验失败。')
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(file).buffer))
      )
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      if (hash !== item.hash.toLowerCase()) throw new Error('ZIP 文件摘要校验失败。')
    }
  } else input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (!input || typeof input !== 'object') throw new Error('备份结构校验失败。')
  let root = input as Record<string, unknown>
  if (root.format === 'coc.logbook.android') {
    if (root.formatVersion !== 1 || !root.snapshot || typeof root.snapshot !== 'object')
      throw new Error('安卓备份版本不兼容。')
    root = root.snapshot as Record<string, unknown>
  }
  if (root.schemaVersion !== 1 && root.schemaVersion !== 2) throw new Error('备份版本不兼容。')
  const parsed = payloadSchema.safeParse(root)
  if (!parsed.success) throw new Error('备份数据结构无效；未写入任何数据。')
  const payload = parsed.data
  for (const rows of [payload.modules, payload.records, payload.characters]) {
    if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error('备份包含重复标识。')
  }
  const modules = new Set(payload.modules.map((m) => m.id))
  const characters = new Set(payload.characters.map((c) => c.id))
  if (
    payload.records.some((r) => !modules.has(r.moduleId)) ||
    payload.characters.some((c) =>
      [...c.moduleIds, ...(c.moduleId ? [c.moduleId] : [])].some((id) => !modules.has(id))
    ) ||
    payload.modules.some((m) => m.pairs.some((p) => p.characterId && !characters.has(p.characterId)))
  )
    throw new Error('备份包含失效的业务关联。')
  if (
    payload.records.some(
      (r) =>
        r.sourceType === 'online' &&
        r.rawContent &&
        ((r.cacheSourceUrl && r.cacheSourceUrl !== r.link) ||
          (r.rawContent.sourceUrl && r.rawContent.sourceUrl !== r.link))
    )
  )
    throw new Error('正文来源与场次链接不匹配。')
  const snapshot: MobileSnapshot = {
    schemaVersion: 2,
    exportedAt: payload.exportedAt,
    modules: payload.modules,
    records: payload.records,
    characters: payload.characters,
    settings: {
      theme: payload.settings?.theme ?? 'light',
      filterPreset: { ...DEFAULT_FILTER_PRESET, ...payload.settings?.filterPreset }
    }
  }
  const offlineRecords = snapshot.records.filter(
    (r) => r.rawContent || (r.sourceType === 'manual' && r.manualContent)
  ).length
  const warnings = ['安卓不保留资料汇总与跑团闲记。', '本阶段不导入归档附件；原备份和原文件保持不动。']
  if (offlineRecords < snapshot.records.length)
    warnings.push(`${snapshot.records.length - offlineRecords} 个场次未带正文，导入后不能凭链接离线阅读。`)
  return { snapshot, offlineRecords, warnings }
}

/**
 * 编码安卓完整文字备份。
 * @param snapshot - 当前安卓业务数据，不含电脑专属模块。
 * @returns 可写入用户归档目录的 UTF-8 字节。
 */
export function encodeBackup(snapshot: MobileSnapshot): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      format: 'coc.logbook.android',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      restoreScope: ['modules', 'records', 'characters'],
      snapshot
    })
  )
}
