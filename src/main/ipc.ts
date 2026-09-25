import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { ApiResult } from '../shared/api'
import { AppError, serializeError } from '../shared/errors'
import { outlineToMarkdown, pageToSvg, parseEmmx } from '../shared/emmx'
import { htmlMindmapOutline, parseMindmapHtml } from '../shared/mindmap-html'
import { sanitizeWindowsName } from '../shared/safe-path'
import { ArchivePathService, inspectArchiveDirectory } from './archive-path'
import type { AppRepository } from './repository'
import type { SeaLogService } from './sea-log-service'
import type { FileService } from './file-service'
import type { TableExportService } from './table-export-service'
import type { CharacterFileService } from './character-file-service'
import type { BackupService } from './backup-service'
import type { NoteFileService } from './note-file-service'

const id = z.string().uuid()
const text = z.string().max(10_000)
const optionalText = text.optional()
const pair = z.object({ pc: text, pl: text, characterId: id.optional() })
const noteImage = z.object({ path: z.string().max(400), name: z.string().max(260) })
const noteInput = z.object({
  moduleName: z.string().max(200).optional(),
  content: z.string().max(200_000).optional(),
  noteDate: z.string().max(20).optional(),
  images: z.array(noteImage).max(60).optional()
})
const notePatch = noteInput.partial()
const noteImageUpload = z.object({
  name: z.string().max(260),
  bytes: z
    .instanceof(Uint8Array)
    .refine((value) => value.byteLength > 0 && value.byteLength <= 25 * 1024 * 1024)
})

const modulePlayStatus = z.enum(['finished', 'running', 'not_started'])
const moduleInput = z.object({
  name: z.string().max(200),
  // 0.6.3 起跑团状态必填：界面不预选，用户必须明确选择
  playStatus: modulePlayStatus,
  kps: z.array(text).max(100).optional(),
  pairs: z.array(pair).max(500).optional()
})
const modulePatch = moduleInput.partial().extend({ collapsed: z.boolean().optional() })
const recordStatus = z.enum(['pending', 'valid', 'fetch_failed', 'manual'])
const recordInput = z.object({
  moduleId: id,
  name: optionalText,
  link: optionalText,
  manualContent: z.string().max(20_000_000).optional(),
  playDate: z.string().max(20).optional(),
  sequenceNo: z.number().int().min(1).max(9999).optional(),
  status: recordStatus.optional(),
  fetchedAt: z.string().max(40).optional()
})
const recordPatch = z.object({
  name: optionalText,
  link: optionalText,
  manualContent: z.string().max(20_000_000).optional(),
  playDate: z.string().max(20).optional(),
  dateSource: z.enum(['parsed', 'manual', 'none']).optional(),
  status: recordStatus.optional(),
  fetchedAt: z.string().max(40).optional()
})
const settingsPatch = z.object({
  theme: z.enum(['light', 'dark']).optional(),
  archiveDirectory: z.string().max(32_000).optional(),
  filterPreset: z
    .object({
      hideDiceCommands: z.boolean(),
      hideImages: z.boolean(),
      hideOffTopic: z.boolean(),
      hideTime: z.boolean(),
      hidePlatformAccount: z.boolean(),
      hideYearMonthDay: z.boolean(),
      indentFirstLine: z.boolean(),
      darkDisplay: z.boolean()
    })
    .partial()
    .optional(),
  autoBackup: z
    .object({
      enabled: z.boolean(),
      interval: z.enum(['idle', 'daily', 'weekly']),
      retention: z.number().int().min(1).max(100)
    })
    .partial()
    .optional()
})
const edition = z.union([z.literal(6), z.literal(7)])
const characterData = z
  .object({
    id,
    moduleId: id.optional(),
    moduleIds: z.array(id).max(100),
    edition,
    basic: z.object({
      name: text,
      occupation: text,
      age: text,
      gender: text,
      birthplace: text,
      residence: text
    }),
    attrs: z.object({
      STR: z.number(),
      CON: z.number(),
      SIZ: z.number(),
      DEX: z.number(),
      APP: z.number(),
      INT: z.number(),
      POW: z.number(),
      EDU: z.number()
    }),
    editionSnapshots: z.record(z.string(), z.record(z.string(), z.number())),
    derived: z.object({
      hpCurrent: z.number(),
      mpCurrent: z.number(),
      sanCurrent: z.number(),
      luck6: z.number().optional(),
      luck7: z.number().optional(),
      db: text
    }),
    occupationFormula: text,
    occupationPointOverride: z.number().optional(),
    skills: z.array(
      z.object({
        id,
        name: text,
        base: z.number(),
        occupation: z.number(),
        interest: z.number(),
        growth: z.number(),
        hidden: z.boolean().optional(),
        builtIn: z.boolean().optional(),
        mappingState: z.enum(['ok', 'review', 'unmapped']).optional()
      })
    ),
    weapons: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
    items: z.array(text),
    background: z.record(z.string(), text),
    story: text,
    createdAt: text,
    updatedAt: text
  })
  .strict()

/**
 * 字段名 → 用户看得懂的中文。
 *
 * 校验失败时要说清「哪个字段、错在哪」，而不是笼统的「输入内容不完整或格式不正确」。
 * 用户看到「资料 ID 无效」就知道是数据坏了，看到「标题过长（最多 300 字）」
 * 就知道该改什么；只给一句通用提示等于没说。
 */
const FIELD_LABELS: Record<string, string> = {
  id: '资料 ID',
  moduleId: '归属模组',
  title: '标题',
  name: '名称',
  path: '文件路径',
  url: '链接地址',
  note: '备注',
  kind: '资料类型',
  content: '正文',
  targetPath: '文件路径',
  targetIndex: '排序位置',
  paths: '文件列表',
  images: '图片',
  moduleName: '模组名',
  noteDate: '日期',
  link: '跑团链接',
  playStatus: '跑团状态',
  sequenceNo: '场次编号',
  kps: 'KP',
  pairs: 'PC / PL',
  format: '导出格式',
  theme: '主题',
  edition: '规则版本',
  skills: '技能',
  weapons: '武器',
  items: '物品',
  attrs: '基础属性',
  derived: '派生属性',
  basic: '基本信息',
  background: '背景',
  story: '经历',
  occupation: '职业',
  skills_json: '技能',
  kps_json: 'KP',
  pairs_json: 'PC / PL'
}

/** zod 的 issue → 用户看得懂的说法（zod v4 的 code 与字段名见下面的实测形状） */
function describeIssue(issue: z.core.$ZodIssue): string {
  const field = issue.path.length ? issue.path.map((part) => String(part)).join('.') : ''
  const label = FIELD_LABELS[field] ?? (field || '输入内容')
  switch (issue.code) {
    case 'invalid_type': {
      const detail = issue as { expected?: string; input?: unknown }
      /*
       * 判断「没填」还是「填错类型」。
       *
       * zod v4 的 issue 上**没有** input 字段（v3 有），只有英文 message，
       * 形如 `Invalid input: expected string, received undefined`。
       * 所以这里从 message 里取 received 那一截：是 undefined 才算「没填」，
       * 否则是类型不对（把数字当文字传之类）。取不到就按类型不对处理——
       * 说「格式不对」比误报「没填」更贴近事实。
       */
      const received =
        detail.input !== undefined
          ? detail.input
          : /received\s+(\S+)/.exec(issue.message)?.[1]
      if (received === undefined || received === 'undefined') {
        return `${label}：缺少必填内容`
      }
      return `${label}：格式不对（应为${describeExpected(detail.expected)}）`
    }
    case 'too_small': {
      const detail = issue as { origin?: string; minimum?: number | bigint }
      if (detail.origin === 'string') return `${label}：不能为空`
      return `${label}：不能小于 ${String(detail.minimum)}`
    }
    case 'too_big': {
      const detail = issue as { origin?: string; maximum?: number | bigint }
      if (detail.origin === 'string') return `${label}：内容过长，最多 ${String(detail.maximum)} 个字`
      return `${label}：不能大于 ${String(detail.maximum)}`
    }
    case 'invalid_format': {
      const format = (issue as { format?: string }).format
      if (format === 'uuid') return `${label}：无效（数据可能已损坏）`
      if (format === 'url') return `${label}：不是有效的网址`
      if (format === 'email') return `${label}：不是有效的邮箱`
      return `${label}：格式不正确`
    }
    case 'invalid_value': {
      // zod v4 把枚举的候选值放在 values（v3 叫 options）
      const detail = issue as { values?: unknown[]; options?: unknown[] }
      const allowed = detail.values ?? detail.options
      if (Array.isArray(allowed) && allowed.length) {
        return `${label}：只能选 ${allowed.map((item) => String(item)).join(' / ')}`
      }
      return `${label}：取值不对`
    }
    case 'unrecognized_keys': {
      const keys = (issue as { keys?: string[] }).keys ?? []
      return `出现了不认识的字段：${keys.join('、')}`
    }
    case 'invalid_union':
      return `${label}：格式不正确`
    case 'not_multiple_of':
      return `${label}：取值不对`
    default:
      return `${label}：${issue.message}`
  }
}

/** zod 的 expected 类型名 → 中文 */
function describeExpected(expected: string | undefined): string {
  if (expected === 'string') return '文字'
  if (expected === 'number') return '数字'
  if (expected === 'boolean') return '是/否'
  if (expected === 'array') return '列表'
  if (expected === 'object') return '一组内容'
  if (expected === 'undefined') return '留空'
  return expected ?? '其它格式'
}

/** 把 zod 的报错整理成一句用户能照着改的提示 */
function describeValidationError(error: z.ZodError): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const issue of error.issues) {
    const text = describeIssue(issue)
    // 同一个字段可能报多条，去重后更易读
    if (seen.has(text)) continue
    seen.add(text)
    parts.push(text)
    if (parts.length >= 3) break
  }
  return parts.length ? parts.join('；') : '输入内容不完整或格式不正确。'
}

function register<TInput, TOutput>(
  channel: string,
  schema: z.ZodType<TInput>,
  action: (input: TInput) => TOutput | Promise<TOutput>
): void {
  ipcMain.handle(channel, async (_event, rawInput): Promise<ApiResult<TOutput>> => {
    try {
      const input = schema.parse(rawInput)
      const value = await action(input)
      notifySuccessfulChannel?.(channel)
      return { ok: true, value }
    } catch (error) {
      const normalized =
        error instanceof z.ZodError
          ? new AppError('VALIDATION_INPUT', 'VALIDATION', describeValidationError(error))
          : error
      return { ok: false, error: serializeError(normalized) }
    }
  })
}

const empty = z.object({}).strict()
const automaticBackupChannels = new Set([
  'modules:create',
  'modules:update',
  'modules:delete',
  'modules:move',
  'records:create',
  'records:update',
  'records:delete',
  'records:move',
  'records:probe',
  'records:reset-probe',
  'characters:create',
  'characters:update',
  'characters:convert',
  'characters:move',
  'characters:delete',
  'notes:create',
  'notes:update',
  'notes:delete',
  'resources:create',
  'resources:update',
  'resources:delete',
  'resources:move',
  'resources:set-module',
  'resources:remove-group',
  'settings:update',
  'files:export-record',
  'files:batch-export',
  'files:export-combined',
  'files:export-table',
  'files:export-character',
  'files:save-character-template',
  'files:commit-character-import',
  'files:choose-archive-directory',
  'backup:restore'
])
const automaticBackupScheduleChannels = new Set([
  'settings:update',
  'files:choose-archive-directory',
  'backup:restore',
  'backup:clear-data'
])
let notifySuccessfulChannel: ((channel: string) => void) | undefined

export function registerIpc(
  repository: AppRepository,
  windowProvider: () => BrowserWindow | null,
  seaLogService: SeaLogService,
  fileService: FileService,
  tableExportService: TableExportService,
  characterFileService: CharacterFileService,
  noteFileService: NoteFileService,
  backupService: BackupService,
  dataDirectory: string
): void {
  notifySuccessfulChannel = (channel) => {
    if (automaticBackupScheduleChannels.has(channel)) backupService.refreshAutomaticBackups()
    if (automaticBackupChannels.has(channel)) backupService.queueAutomaticBackup()
  }

  register('app:snapshot', empty, () => repository.snapshot())
  register('app:version', empty, () => app.getVersion())

  register('modules:create', moduleInput, (input) => repository.createModule(input))
  register('modules:update', z.object({ id, patch: modulePatch }), ({ id: moduleId, patch }) =>
    repository.updateModule(moduleId, patch)
  )
  register('modules:delete', z.object({ id }), ({ id: moduleId }) => repository.deleteModule(moduleId))
  register(
    'modules:move',
    z.object({ id, direction: z.union([z.literal(-1), z.literal(1)]) }),
    ({ id: moduleId, direction }) => repository.moveModule(moduleId, direction)
  )

  register('records:create', recordInput, (input) => repository.createRecord(input))
  register('records:update', z.object({ id, patch: recordPatch }), ({ id: recordId, patch }) =>
    repository.updateRecord(recordId, patch)
  )
  register('records:delete', z.object({ id }), ({ id: recordId }) => repository.deleteRecord(recordId))
  register(
    'records:move',
    z.object({ id, direction: z.union([z.literal(-1), z.literal(1)]) }),
    ({ id: recordId, direction }) => repository.moveRecord(recordId, direction)
  )
  register(
    'records:duplicate',
    z.object({ moduleId: id, link: text, excludingId: id.optional() }),
    ({ moduleId, link, excludingId }) => repository.findDuplicateLink(moduleId, link, excludingId)
  )
  register('records:probe', z.object({ id }), ({ id: recordId }) => seaLogService.probe(recordId))
  register('records:reset-probe', z.object({ id }), ({ id: recordId }) =>
    repository.resetRecordProbeState(recordId)
  )
  register('records:realign-sequences', z.object({ moduleId: id }), ({ moduleId }) =>
    repository.realignModuleSequences(moduleId)
  )

  register(
    'characters:create',
    z.object({
      edition,
      moduleId: id.optional(),
      moduleIds: z.array(id).max(100).optional(),
      name: optionalText
    }),
    (input) => repository.createCharacter(input)
  )
  register('characters:update', z.object({ id, data: characterData }), ({ id: characterId, data }) =>
    repository.updateCharacter(characterId, data)
  )
  register('characters:convert', z.object({ id, edition }), ({ id: characterId, edition: target }) =>
    repository.convertCharacter(characterId, target)
  )
  register(
    'characters:move',
    z.object({
      id,
      moduleId: id.optional(),
      oldModulePolicy: z.enum(['remove', 'retain-name', 'cancel'])
    }),
    ({ id: characterId, moduleId, oldModulePolicy }) =>
      repository.moveCharacter(characterId, moduleId, oldModulePolicy)
  )
  register('characters:delete', z.object({ id }), ({ id: characterId }) =>
    repository.deleteCharacter(characterId)
  )

  register('notes:create', noteInput, (input) => repository.createNote(input))
  register('notes:update', z.object({ id, patch: notePatch }), ({ id: noteId, patch }) => {
    const before = repository.findNote(noteId)
    const updated = repository.updateNote(noteId, patch)
    if (patch.images) {
      const kept = new Set(updated.images.map((image) => image.path))
      noteFileService.remove(before.images.filter((image) => !kept.has(image.path)))
    }
    return updated
  })
  register('notes:delete', z.object({ id }), ({ id: noteId }) => {
    const note = repository.findNote(noteId)
    repository.deleteNote(noteId)
    noteFileService.remove(note.images)
  })
  register('settings:update', settingsPatch, (patch) => repository.updateSettings(patch))

  register('backup:create', z.object({ includeArchives: z.boolean() }), ({ includeArchives }) =>
    backupService.createBackup(includeArchives)
  )
  register('backup:choose-restore', empty, async () => {
    const options: Electron.OpenDialogOptions = {
      title: '选择要恢复的备份',
      properties: ['openFile'],
      filters: [{ name: 'COC 备份', extensions: ['json', 'zip'] }]
    }
    const owner = windowProvider()
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return undefined
    return backupService.previewBackup(result.filePaths[0])
  })
  register(
    'backup:restore',
    z.object({
      token: id,
      options: z.object({ restoreSettings: z.boolean(), archiveDirectory: z.string().max(32_000).optional() })
    }),
    ({ token, options }) => backupService.restore(token, options)
  )
  register('backup:cache-stats', empty, () => backupService.cacheStats())
  register('backup:clear-cache', empty, () => backupService.clearCache())
  register(
    'backup:clear-data',
    z.object({
      resetSettings: z.boolean(),
      clearMappings: z.boolean(),
      deleteRegisteredArchives: z.boolean()
    }),
    (options) => backupService.clearBusinessData(options)
  )

  register(
    'files:export-record',
    z.object({ id, format: z.enum(['raw', 'doc', 'dialogue-doc', 'docx', 'txt', 'pdf']) }),
    ({ id: recordId, format }) => fileService.exportRecord(recordId, format)
  )
  register(
    'files:batch-export',
    z.object({
      ids: z.array(id).min(1).max(10_000),
      format: z.enum(['raw', 'doc', 'dialogue-doc', 'docx', 'txt', 'pdf'])
    }),
    ({ ids, format }) => fileService.batchExport(ids, format)
  )
  register(
    'files:export-combined',
    z.object({ ids: z.array(id).min(1).max(10_000), format: z.enum(['txt', 'docx', 'pdf']) }),
    ({ ids, format }) => fileService.exportCombined(ids, format)
  )
  register(
    'files:export-table',
    z.object({ ids: z.array(id).max(100_000).optional(), format: z.enum(['csv', 'xlsx']) }),
    ({ ids, format }) => tableExportService.export(format, ids)
  )
  register(
    'files:export-character',
    z.object({ id, format: z.enum(['xlsx', 'pdf']) }),
    ({ id: characterId, format }) => characterFileService.exportCharacter(characterId, format)
  )
  register('files:save-character-template', z.object({ edition }), ({ edition: target }) =>
    characterFileService.saveBlankTemplate(target)
  )
  register('files:choose-character-import', empty, async () => {
    const options: Electron.OpenDialogOptions = {
      title: '选择角色卡表格',
      properties: ['openFile'],
      filters: [{ name: '角色卡表格', extensions: ['xlsx', 'xls', 'csv'] }]
    }
    const owner = windowProvider()
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return undefined
    return characterFileService.previewImport(result.filePaths[0])
  })
  register(
    'files:commit-character-import',
    z.object({
      token: id,
      selections: z.array(
        z.object({
          sheetName: text,
          edition,
          moduleId: id.optional(),
          mapping: z.record(z.string(), z.string()),
          skillHeaderRow: z.number().int().min(0).optional(),
          mappingName: optionalText
        })
      )
    }),
    ({ token, selections }) => characterFileService.commitImport(token, selections)
  )
  register('files:archive-status', empty, () =>
    inspectArchiveDirectory(repository.getSettings().archiveDirectory)
  )
  register('files:archive-default', empty, () => {
    // 恢复成当前登录用户的“文档\COC跑团记录”。换过 Windows 账户后，
    // 老设置里可能残留别的用户目录（如 C:\Users\Administrator），写不进去。
    const fallback = path.join(app.getPath('documents'), 'COC跑团记录')
    repository.updateSettings({ archiveDirectory: fallback })
    return fallback
  })
  register('files:choose-archive-directory', empty, async () => {
    const options: Electron.OpenDialogOptions = {
      title: '选择下载归档位置',
      defaultPath: repository.getSettings().archiveDirectory,
      properties: ['openDirectory', 'createDirectory']
    }
    const owner = windowProvider()
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    const selected = result.canceled ? undefined : result.filePaths[0]
    if (selected) repository.updateSettings({ archiveDirectory: selected })
    return selected
  })
  register(
    'files:open-directory',
    z.object({ kind: z.enum(['archive', 'data', 'logs', 'module']), moduleId: id.optional() }),
    async ({ kind, moduleId }) => {
      let directory = repository.getSettings().archiveDirectory
      if (kind === 'data') directory = dataDirectory
      if (kind === 'logs') directory = path.join(dataDirectory, 'logs')
      if (kind === 'module') {
        if (!moduleId) throw new AppError('MODULE_REQUIRED', 'VALIDATION', '请选择一个模组。')
        directory = fileService.moduleDirectory(moduleId)
      }
      fs.mkdirSync(directory, { recursive: true })
      const error = await shell.openPath(directory)
      if (error) throw new AppError('OPEN_DIRECTORY_FAILED', 'FILE', '无法打开文件夹，请检查路径。')
    }
  )
  register('files:show-item', z.object({ targetPath: z.string().max(32_000) }), ({ targetPath }) => {
    const resolved = path.resolve(targetPath)
    if (!fs.existsSync(resolved)) {
      throw new AppError('SHOW_ITEM_MISSING', 'FILE', '文件已经不存在，请检查归档目录。')
    }
    shell.showItemInFolder(resolved)
  })
  register('files:choose-note-image', empty, async () => {
    const options: Electron.OpenDialogOptions = {
      title: '选择图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
    }
    const owner = windowProvider()
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    return result.filePaths.map((filePath) => noteFileService.saveFromPath(filePath))
  })
  register('files:paste-note-image', noteImageUpload, ({ name, bytes }) =>
    noteFileService.saveFromBytes(bytes, name)
  )

  // ============ 0.6.8 模组资料汇总 ============
  const resourceKind = z.enum(['mindmap', 'link', 'file'])
  const resourceInput = z.object({
    // 归属可选：不传就是未归属任何模组的资料
    moduleId: id.optional(),
    kind: resourceKind,
    title: z.string().max(300).optional(),
    path: z.string().max(32_000).optional(),
    url: z.string().max(32_000).optional(),
    note: z.string().max(10_000).optional()
  })
  register('resources:create', resourceInput, (input) => repository.createResource(input))
  register(
    'resources:set-module',
    z.object({ id, moduleId: id.optional() }),
    ({ id: resourceId, moduleId }) => repository.setResourceModule(resourceId, moduleId)
  )
  register(
    'resources:update',
    z.object({
      id,
      title: z.string().max(300).optional(),
      path: z.string().max(32_000).optional(),
      url: z.string().max(32_000).optional(),
      note: z.string().max(10_000).optional()
    }),
    ({ id: resourceId, ...patch }) => repository.updateResource(resourceId, patch)
  )
  register('resources:delete', z.object({ id }), ({ id: resourceId }) =>
    repository.deleteResource(resourceId)
  )
  register('resources:move', z.object({ id, targetIndex: z.number().int().min(0).max(999) }), ({ id: resourceId, targetIndex }) =>
    repository.moveResource(resourceId, targetIndex)
  )

  /**
   * 0.7.0：把一个分组从「资料汇总」页移除。
   *
   * 只影响这个页面的显示：模组本身、场次、角色卡都不受影响。
   *
   * 0.7.1：这里不能用 id（uuid）校验——「未归属模组」分组没有模组 id，
   * 它用 UNASSIGNED_GROUP 哨兵来记。用 uuid 校验会把哨兵挡在门外，
   * 界面只看到「输入内容不完整或格式不正确」，分组也就删不掉。
   */
  register(
    'resources:remove-group',
    z.object({ moduleId: z.string().min(1).max(120) }),
    ({ moduleId }) => repository.hideResourceGroup(moduleId)
  )

  /** 选一个或多个文件，返回路径与建议标题；导图、文件都用它 */
  register(
    'resources:choose-files',
    z.object({ kind: resourceKind }),
    async ({ kind }) => {
      const options: Electron.OpenDialogOptions = {
        title: kind === 'mindmap' ? '选择思维导图' : '选择文件',
        properties: ['openFile', 'multiSelections'],
        filters:
          kind === 'mindmap'
            ? [
                // HTML 是新版 .emmx 的推荐替代：图形由 EdrawMind 自己渲染，完整且离线可用
                { name: '思维导图（推荐 HTML）', extensions: ['html', 'htm', 'emmx', 'emmxz'] },
                { name: 'EdrawMind 源文件', extensions: ['emmx', 'emmxz'] },
                { name: 'EdrawMind 网页导出', extensions: ['html', 'htm'] }
              ]
            : [
                { name: '常见资料', extensions: ['pdf', 'doc', 'docx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'xlsx', 'pptx'] },
                { name: '全部文件', extensions: ['*'] }
              ]
      }
      const owner = windowProvider()
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled) return []
      return result.filePaths.map((filePath) => ({
        path: filePath,
        title: path.basename(filePath, path.extname(filePath))
      }))
    }
  )

  /**
   * 读取导图并转成矢量 SVG + 层级大纲。
   *
   * 只读不写：软件不复制也不修改用户的导图文件，编辑仍在 EdrawMind 里进行。
   * 线条按导图内部的真实几何绘制（曲线、分组框、概括括号、关系连线标签），
   * 不是一律直线。
   */
  register('resources:read-mindmap', z.object({ targetPath: z.string().max(32_000) }), ({ targetPath }) => {
    const resolved = path.resolve(targetPath)
    if (!fs.existsSync(resolved)) {
      throw new AppError('RESOURCE_MISSING', 'FILE', '导图文件找不到了，请重新指定路径。')
    }
    const extension = path.extname(resolved).toLowerCase()

    // HTML 导出：每个子页面就是一个现成的 <svg>，图形由 EdrawMind 自己渲染，
    // 100% 准确，且没有外部依赖。新版 .emmx 的画布是私有二进制、无法可靠还原，
    // 所以复杂导图建议走这条路。
    if (extension === '.html' || extension === '.htm') {
      const document = parseMindmapHtml(fs.readFileSync(resolved, 'utf8'))
      if (!document.pages.length) {
        throw new AppError('HTML_NO_PAGE', 'PARSE', '这个 HTML 里没有可显示的导图画布。')
      }
      return {
        format: 'html' as const,
        modifiedAt: document.modifiedAt,
        outline: htmlMindmapOutline(document).map((text) => ({ text, depth: 0 })),
        pages: document.pages.map((page) => ({
          name: page.id,
          title: page.title,
          width: page.width,
          height: page.height,
          svg: page.svg,
          textCount: page.texts.length,
          texts: page.texts
        }))
      }
    }

    let document
    try {
      document = parseEmmx(fs.readFileSync(resolved))
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('EMMX_READ_FAILED', 'PARSE', '无法读取这个导图文件。', false, error)
    }
    return {
      format: 'emmx' as const,
      modifiedAt: document.modifiedAt,
      // 大纲是带层级的，界面按 depth 缩进显示
      outline: document.outline,
      pages: document.pages.map((page) => ({
        name: page.name,
        title: page.title,
        width: Math.round(page.bounds.maxX - page.bounds.minX),
        height: Math.round(page.bounds.maxY - page.bounds.minY),
        svg: pageToSvg(page),
        // 节点数只算画出来的那些：折叠分支里的节点不显示，算进去会让
        // 界面上的数字与看到的内容对不上（见 emmx.ts 的 hidden 说明）
        textCount: page.shapes.reduce(
          (sum, shape) => sum + (shape.hidden ? 0 : shape.lines.length),
          0
        ),
        // 节点搜索用：普通节点文字 + 关系连线标签 + 分组框标题
        // 这里**包含**折叠的节点——折叠只是不显示，内容不该搜不到
        texts: [
          ...page.shapes.flatMap((shape) => shape.lines),
          ...page.labels.flatMap((label) => label.lines)
        ]
      }))
    }
  })

  /**
   * 读取任意本地图片，供资料汇总显示缩略图。
   *
   * 闲记图片走的是 coc-media 协议，那个协议只允许访问程序自己的 data/notes 目录，
   * 而资料里的图片在用户自己的目录（如 E:\COC模组\...），所以单独开一条通道。
   * 只读、不写、不改动原文件。
   */
  register('resources:read-image', z.object({ targetPath: z.string().max(32_000) }), ({ targetPath }) => {
    const resolved = path.resolve(targetPath)
    if (!fs.existsSync(resolved)) {
      throw new AppError('RESOURCE_MISSING', 'FILE', '图片找不到了，请重新指定路径。')
    }
    const extension = path.extname(resolved).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(extension)) {
      throw new AppError('RESOURCE_NOT_IMAGE', 'FILE', '这个文件不是支持的图片格式。')
    }
    const data = fs.readFileSync(resolved)
    // 缩略图不需要原图那么大，但这里直接返回原图交给界面缩放，
    // 避免引入图像处理依赖；上限 32MB 防止误选超大文件卡住界面
    if (data.byteLength > 32 * 1024 * 1024) {
      throw new AppError('RESOURCE_IMAGE_TOO_LARGE', 'FILE', '图片太大（超过 32MB），无法预览。')
    }
    const mime =
      extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg'
        : extension === '.gif'
          ? 'image/gif'
          : extension === '.webp'
            ? 'image/webp'
            : extension === '.bmp'
              ? 'image/bmp'
              : 'image/png'
    return `data:${mime};base64,${data.toString('base64')}`
  })

  /** 重新指定资料的文件路径（内容更新或位置变动时用） */
  register(
    'resources:relink',
    z.object({ id, path: z.string().max(32_000), title: z.string().max(300).optional() }),
    ({ id: resourceId, path: filePath, title }) =>
      repository.updateResource(resourceId, {
        path: filePath,
        ...(title ? { title } : {})
      })
  )

  /**
   * 更新某条资料：让用户重新选一个文件。
   *
   * 用于「内容更新」或「文件挪了位置」。返回新路径与建议标题，由界面决定是否写回。
   */
  register('resources:choose-replacement', z.object({ id }), async ({ id: resourceId }) => {
    const resource = repository.findResource(resourceId)
    const options: Electron.OpenDialogOptions = {
      title: '重新选择这个资料对应的文件',
      properties: ['openFile'],
      defaultPath: resource.path,
      filters:
        resource.kind === 'mindmap'
          ? [{ name: '思维导图', extensions: ['html', 'htm', 'emmx', 'emmxz'] }]
          : [{ name: '全部文件', extensions: ['*'] }]
    }
    const owner = windowProvider()
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return undefined
    const filePath = result.filePaths[0]
    return { path: filePath, title: path.basename(filePath, path.extname(filePath)) }
  })

  /** 把导图大纲导出成 markdown，供拿到别的软件里用 */
  register(
    'resources:export-outline',
    z.object({ targetPath: z.string().max(32_000), title: z.string().max(300) }),
    async ({ targetPath, title }) => {
      const resolved = path.resolve(targetPath)
      if (!fs.existsSync(resolved)) {
        throw new AppError('RESOURCE_MISSING', 'FILE', '导图文件找不到了，请重新指定路径。')
      }
      const document = parseEmmx(fs.readFileSync(resolved))
      const markdown = outlineToMarkdown(document, title || path.basename(resolved, '.emmx'))
      const directory = repository.getSettings().archiveDirectory
      const pathService = new ArchivePathService(() => directory)
      const destination = pathService.availableRootFile(
        `${sanitizeWindowsName(title || path.basename(resolved, '.emmx'), '导图大纲')}.md`
      )
      fs.writeFileSync(destination, markdown, 'utf8')
      return destination
    }
  )

  /**
   * 取文件在系统里的真实图标（docx 显示 Word 图标、pdf 显示 PDF 图标）。
   *
   * 结果转成 data URL 交给界面，避免为每个文件开一条 coc-media 通道。
   * 图标读不到（文件已删、系统没有关联程序）时返回 undefined，界面退回内置图标。
   */
  register(
    'resources:file-icons',
    z.object({ paths: z.array(z.string().max(32_000)).max(300) }),
    async ({ paths: filePaths }) => {
      const results = await Promise.all(
        filePaths.map(async (item) => {
          try {
            if (!fs.existsSync(item)) return undefined
            const icon = await app.getFileIcon(item, { size: 'normal' })
            return `data:image/png;base64,${icon.toPNG().toString('base64')}`
          } catch {
            return undefined
          }
        })
      )
      return results
    }
  )

  /** 用系统默认程序打开资料：导图交给 EdrawMind，文件交给关联程序，链接交给浏览器 */
  register('resources:open', z.object({ id }), async ({ id: resourceId }) => {
    const resource = repository.findResource(resourceId)
    if (resource.kind === 'link') {
      if (!resource.url) throw new AppError('RESOURCE_NO_URL', 'FILE', '这条资料还没有填写网址。')
      await shell.openExternal(resource.url)
      return
    }
    if (!resource.path) throw new AppError('RESOURCE_NO_PATH', 'FILE', '这条资料还没有指定文件。')
    if (!fs.existsSync(resource.path)) {
      throw new AppError('RESOURCE_MISSING', 'FILE', '文件找不到了，可能已被移动或删除，请重新指定路径。')
    }
    const error = await shell.openPath(resource.path)
    if (error) throw new AppError('RESOURCE_OPEN_FAILED', 'FILE', '无法打开这个文件，请检查系统关联程序。')
  })

  /** 检查一批路径是否还在，供界面标出失效的资料 */
  register(
    'resources:check-paths',
    z.object({ paths: z.array(z.string().max(32_000)).max(500) }),
    ({ paths }) => paths.map((item) => fs.existsSync(item))
  )

  ipcMain.handle('window:get-bounds', () => windowProvider()?.getBounds())
  const parseWindowBounds = (rawBounds: unknown): Electron.Rectangle =>
    z
      .object({
        x: z.number().int(),
        y: z.number().int(),
        width: z.number().int().min(960),
        height: z.number().int().min(640)
      })
      .parse(rawBounds)
  const applyWindowBounds = (rawBounds: unknown): void => {
    const bounds = parseWindowBounds(rawBounds)
    const window = windowProvider()
    if (window && !window.isMaximized()) window.setBounds(bounds)
  }
  ipcMain.handle('window:set-bounds', (_event, rawBounds) => applyWindowBounds(rawBounds))
  ipcMain.handle('window:is-maximized', () =>
    windowProvider()?.isMaximized() ?? false
  )
  ipcMain.handle('window:minimize', () => windowProvider()?.minimize())
  ipcMain.handle('window:toggle-maximize', () => {
    const window = windowProvider()
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.handle('window:close', () => windowProvider()?.close())
}
