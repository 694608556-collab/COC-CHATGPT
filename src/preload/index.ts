import { contextBridge, ipcRenderer } from 'electron'
import type { CocApi, ApiResult } from '../shared/api'

async function invoke<T>(channel: string, input: unknown = {}): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, input)) as ApiResult<T>
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

const api: CocApi = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    getBounds: () => ipcRenderer.invoke('window:get-bounds'),
    setBounds: (bounds) => ipcRenderer.invoke('window:set-bounds', bounds),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized')
  },
  app: { snapshot: () => invoke('app:snapshot'), version: () => invoke('app:version') },
  modules: {
    create: (input) => invoke('modules:create', input),
    update: (id, patch) => invoke('modules:update', { id, patch }),
    delete: (id) => invoke('modules:delete', { id }),
    move: (id, direction) => invoke('modules:move', { id, direction })
  },
  records: {
    create: (input) => invoke('records:create', input),
    update: (id, patch) => invoke('records:update', { id, patch }),
    delete: (id) => invoke('records:delete', { id }),
    move: (id, direction) => invoke('records:move', { id, direction }),
    findDuplicate: (moduleId, link, excludingId) =>
      invoke('records:duplicate', { moduleId, link, excludingId }),
    probe: (id) => invoke('records:probe', { id })
  },
  characters: {
    create: (input) => invoke('characters:create', input),
    update: (id, data) => invoke('characters:update', { id, data }),
    convert: (id, edition) => invoke('characters:convert', { id, edition }),
    move: (id, moduleId, oldModulePolicy) => invoke('characters:move', { id, moduleId, oldModulePolicy }),
    delete: (id) => invoke('characters:delete', { id })
  },
  notes: {
    create: (input) => invoke('notes:create', input),
    update: (id, patch) => invoke('notes:update', { id, patch }),
    delete: (id) => invoke('notes:delete', { id })
  },
  settings: { update: (patch) => invoke('settings:update', patch) },
  files: {
    exportRecord: (id, format) => invoke('files:export-record', { id, format }),
    batchExport: (ids, format) => invoke('files:batch-export', { ids, format }),
    exportCombined: (ids, format) => invoke('files:export-combined', { ids, format }),
    exportTable: (ids, format) => invoke('files:export-table', { ids, format }),
    exportCharacter: (id, format) => invoke('files:export-character', { id, format }),
    saveCharacterTemplate: (edition) => invoke('files:save-character-template', { edition }),
    chooseCharacterImport: () => invoke('files:choose-character-import'),
    commitCharacterImport: (token, selections) =>
      invoke('files:commit-character-import', { token, selections }),
    chooseNoteImage: () => invoke('files:choose-note-image'),
    pasteNoteImage: (input) => invoke('files:paste-note-image', input),
    chooseArchiveDirectory: () => invoke('files:choose-archive-directory'),
    openDirectory: (kind, moduleId) => invoke('files:open-directory', { kind, moduleId }),
    showItem: (targetPath: string) => invoke('files:show-item', { targetPath })
  },
  backup: {
    create: (includeArchives) => invoke('backup:create', { includeArchives }),
    chooseRestore: () => invoke('backup:choose-restore'),
    restore: (token, options) => invoke('backup:restore', { token, options }),
    cacheStats: () => invoke('backup:cache-stats'),
    clearCache: () => invoke('backup:clear-cache'),
    clearData: (options) => invoke('backup:clear-data', options)
  }
}

contextBridge.exposeInMainWorld('coc', api)
