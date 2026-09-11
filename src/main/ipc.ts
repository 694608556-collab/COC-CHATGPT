import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { ApiResult } from '../shared/api'
import { AppError, serializeError } from '../shared/errors'
import type { AppRepository } from './repository'
import type { SeaLogService } from './sea-log-service'
import type { FileService } from './file-service'
import type { TableExportService } from './table-export-service'
import type { CharacterFileService } from './character-file-service'
import type { BackupService } from './backup-service'

const id = z.string().uuid()
const text = z.string().max(10_000)
const optionalText = text.optional()
const pair = z.object({ pc: text, pl: text, characterId: id.optional() })
const moduleInput = z.object({
  name: z.string().max(200),
  kps: z.array(text).max(100).optional(),
  pairs: z.array(pair).max(500).optional()
})
const modulePatch = moduleInput.partial().extend({ collapsed: z.boolean().optional() })
const recordInput = z.object({
  moduleId: id,
  name: optionalText,
  link: optionalText,
  manualContent: z.string().max(20_000_000).optional(),
  playDate: z.string().max(20).optional()
})
const recordPatch = z.object({
  name: optionalText,
  link: optionalText,
  manualContent: z.string().max(20_000_000).optional(),
  playDate: z.string().max(20).optional(),
  dateSource: z.enum(['parsed', 'manual', 'none']).optional()
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
          ? new AppError('VALIDATION_INPUT', 'VALIDATION', '输入内容不完整或格式不正确。')
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
  'characters:create',
  'characters:update',
  'characters:convert',
  'characters:move',
  'characters:delete',
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
  backupService: BackupService,
  dataDirectory: string
): void {
  notifySuccessfulChannel = (channel) => {
    if (automaticBackupScheduleChannels.has(channel)) backupService.refreshAutomaticBackups()
    if (automaticBackupChannels.has(channel)) backupService.queueAutomaticBackup()
  }

  register('app:snapshot', empty, () => repository.snapshot())

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

  register('characters:create', z.object({ edition, moduleId: id.optional(), name: optionalText }), (input) =>
    repository.createCharacter(input)
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
    z.object({ ids: z.array(id).min(1).max(10_000), format: z.enum(['raw', 'doc', 'dialogue-doc', 'docx', 'txt', 'pdf']) }),
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

  ipcMain.handle('window:minimize', () => windowProvider()?.minimize())
  ipcMain.handle('window:toggle-maximize', () => {
    const window = windowProvider()
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.handle('window:close', () => windowProvider()?.close())
}
