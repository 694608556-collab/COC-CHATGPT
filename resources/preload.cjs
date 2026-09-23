const { contextBridge, ipcRenderer } = require('electron')

async function invoke(channel, input = {}) {
  const result = await ipcRenderer.invoke(channel, input)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

contextBridge.exposeInMainWorld('coc', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    getBounds: () => ipcRenderer.invoke('window:get-bounds'),
    setBounds: (bounds) => ipcRenderer.invoke('window:set-bounds', bounds),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized')
  },
  app: {
    snapshot: () => invoke('app:snapshot'),
    version: () => invoke('app:version')
  },
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
    probe: (id) => invoke('records:probe', { id }),
    resetProbe: (id) => invoke('records:reset-probe', { id }),
    realignSequences: (moduleId) => invoke('records:realign-sequences', { moduleId })
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
  resources: {
    create: (input) => invoke('resources:create', input),
    update: (id, patch) => invoke('resources:update', { id, ...patch }),
    delete: (id) => invoke('resources:delete', { id }),
    move: (id, targetIndex) => invoke('resources:move', { id, targetIndex }),
    removeGroup: (moduleId) => invoke('resources:remove-group', { moduleId }),
    setModule: (id, moduleId) => invoke('resources:set-module', { id, moduleId }),
    chooseFiles: (kind) => invoke('resources:choose-files', { kind }),
    readMindmap: (targetPath) => invoke('resources:read-mindmap', { targetPath }),
    readImage: (targetPath) => invoke('resources:read-image', { targetPath }),
    chooseReplacement: (id) => invoke('resources:choose-replacement', { id }),
    relink: (id, path, title) => invoke('resources:relink', { id, path, title }),
    exportOutline: (targetPath, title) => invoke('resources:export-outline', { targetPath, title }),
    fileIcons: (paths) => invoke('resources:file-icons', { paths }),
    open: (id) => invoke('resources:open', { id }),
    checkPaths: (paths) => invoke('resources:check-paths', { paths })
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
    archiveStatus: () => invoke('files:archive-status'),
    archiveDefault: () => invoke('files:archive-default'),
    openDirectory: (kind, moduleId) => invoke('files:open-directory', { kind, moduleId }),
    showItem: (targetPath) => invoke('files:show-item', { targetPath })
  },
  backup: {
    create: (includeArchives) => invoke('backup:create', { includeArchives }),
    chooseRestore: () => invoke('backup:choose-restore'),
    restore: (token, options) => invoke('backup:restore', { token, options }),
    cacheStats: () => invoke('backup:cache-stats'),
    clearCache: () => invoke('backup:clear-cache'),
    clearData: (options) => invoke('backup:clear-data', options)
  }
})
