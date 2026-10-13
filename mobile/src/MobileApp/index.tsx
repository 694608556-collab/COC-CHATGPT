import { useEffect, useRef, useState } from 'react'
import { DEFAULT_FILTER_PRESET } from '../../../src/shared/types'
import type { FilterPreset, SessionRecord } from '../../../src/shared/types'
import { renderLogText } from '../../../src/shared/document-renderer'
import { Native, decodeBase64, encodeBase64 } from '../data/native'
import type { LogbookPort, NativeState } from '../data/native'
import { previewBackup, encodeBackup, encodeArchiveBackup } from '../data/backup'
import { restoreBackup } from '../data/restore'
import type { ImportPreview, MobileSnapshot } from '../data/types'
import { Records } from './components/Records'
import { CharacterCards } from './components/CharacterCards'
import { DataSettings } from './components/DataSettings'
import { ArchiveGate } from './components/ArchiveGate'
import { RestoreDialog } from './components/RestoreDialog'
import { LogReader } from './components/LogReader'
import { Editor } from './components/Editor'
import { saveEdit } from '../data/edit'
import type { Edit } from '../data/edit'
import { createEmptyCharacter } from '../../../src/shared/coc-rules'
import { NavIcon } from './components/NavIcon'
import { applyAction } from '../data/actions'
import type { DataAction } from '../data/actions'
import { fetchRecord } from '../data/network'
import type { SavedDocument } from '../data/native'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { ExportDialog } from './components/ExportDialog'
import { createExport, safeName } from '../data/export'
import type { ExportFormat } from '../data/export'
import { importTable } from '../data/tables'
import type { TablePreview } from '../data/tables'
import { exportRecordTables } from '../../../src/shared/record-table'
import type { AppSnapshot } from '../../../src/shared/types'

/** @returns 初次使用的空数据，不推测或静默创建归档目录。 */
function emptySnapshot(): MobileSnapshot {
  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    modules: [],
    records: [],
    characters: [],
    settings: { theme: 'light', filterPreset: { ...DEFAULT_FILTER_PRESET } }
  }
}

/** @returns 安卓三模块外壳；所有覆盖与写入仅经原生持久化接口。 */
export function MobileApp({
  port = Native,
  testBackup
}: {
  port?: LogbookPort
  testBackup?: () => Uint8Array
}) {
  const [native, setNative] = useState<NativeState>()
  const [snapshot, setSnapshot] = useState<MobileSnapshot>(emptySnapshot)
  const [page, setPage] = useState<'records' | 'characters' | 'settings'>('records')
  const [record, setRecord] = useState<SessionRecord>()
  const [preview, setPreview] = useState<ImportPreview>()
  const [busy, setBusy] = useState(false)
  const busyLock = useRef(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<{ draft: Edit; revision: number }>()
  const [selectedCharacter, setSelectedCharacter] = useState('')
  const [savedDocument, setSavedDocument] = useState<SavedDocument>()
  const [documents, setDocuments] = useState<SavedDocument[]>([])
  const [exportRequest, setExportRequest] = useState<{
    ids: string[]
    combined: boolean
    filters: FilterPreset
  }>()
  const [tablePreview, setTablePreview] = useState<{ data: TablePreview; revision: number }>()
  async function commit(next: MobileSnapshot) {
    if (!native) throw new Error('本机数据尚未读取。')
    const validated = (
      await previewBackup(
        new TextEncoder().encode(JSON.stringify({ ...next, exportedAt: new Date().toISOString() }))
      )
    ).snapshot
    const result = await port.commitEdit({
      json: JSON.stringify(validated),
      expectedRevision: native.revision
    })
    setSnapshot(validated)
    setNative({ ...native, json: JSON.stringify(validated), revision: result.revision })
    document.documentElement.dataset.theme = validated.settings.theme
  }
  async function act(action: DataAction) {
    if (action.type === 'delete' || action.type === 'clear') {
      const description =
        action.type === 'clear'
          ? '清空全部模组、场次和角色卡？归档文件会保留。'
          : action.kind === 'module'
            ? '删除此模组及其全部场次？角色卡会保留并解除此模组归属。'
            : action.kind === 'character'
              ? '删除此角色卡？参与者姓名会保留，角色关联会解除。'
              : '删除此场次及已保存正文？'
      if (!window.confirm(description + ' 操作前会保存安全副本。')) return
    }
    await commit(await applyAction(snapshot, action))
    if (action.type === 'delete' || action.type === 'clear') {
      setRecord(undefined)
      setSelectedCharacter('')
    }
    setNotice('操作已保存，安全副本已生成。')
  }
  async function probe(ids: string[]) {
    const next = { ...snapshot, records: [...snapshot.records] }
    for (const id of ids) {
      const index = next.records.findIndex((r) => r.id === id)
      if (index < 0 || next.records[index]!.sourceType !== 'online') continue
      next.records[index] = await fetchRecord(port, next.records[index]!)
    }
    await commit(next)
    if (record) setRecord(next.records.find((r) => r.id === record.id))
    const failures = next.records.filter((r) => ids.includes(r.id) && r.status !== 'valid').length
    setNotice(
      '获取完成：' + (ids.length - failures) + ' 个成功，' + failures + ' 个失败。已有正文在失败时保留。'
    )
  }
  async function exportSelected(format: ExportFormat) {
    if (!exportRequest) return
    const selected = snapshot.records
      .filter((r) => exportRequest.ids.includes(r.id))
      .sort((a, b) => a.order - b.order)
    if (!selected.length) throw new Error('所选场次已不存在，请重新选择。')
    const groups = exportRequest.combined
      ? snapshot.modules.map((m) => selected.filter((r) => r.moduleId === m.id)).filter((rows) => rows.length)
      : selected.map((r) => [r])
    const failed: string[] = []
    let count = 0
    for (const group of groups) {
      const available = group.filter((r) => r.rawContent || r.manualContent !== undefined)
      failed.push(...group.filter((r) => !available.includes(r)).map((r) => r.name + '：没有正文'))
      if (!available.length) continue
      try {
        const module = snapshot.modules.find((m) => m.id === available[0]!.moduleId)!
        const file = await createExport(
          module,
          available,
          exportRequest.filters,
          format,
          exportRequest.combined
        )
        const saved = await port.writeArchive({
          name: file.name,
          mime: file.mime,
          base64: encodeBase64(file.bytes)
        })
        setSavedDocument(saved)
        count++
      } catch (reason) {
        failed.push(group[0]!.name + '：' + (reason instanceof Error ? reason.message : '导出失败'))
      }
    }
    setExportRequest(undefined)
    setNotice('导出完成：' + count + ' 个文件保存并回读校验。')
    if (failed.length) setError(failed.join('；'))
  }
  async function exportTables(format: 'csv' | 'xlsx') {
    const files = exportRecordTables(snapshot as unknown as AppSnapshot, format)
    for (const file of files) {
      const suffix = format === 'csv' ? '.csv' : '.xlsx'
      const saved = await port.writeArchive({
        name: safeName(file.name.slice(0, -suffix.length)) + suffix,
        mime:
          format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: encodeBase64(file.bytes)
      })
      setSavedDocument(saved)
    }
    setNotice('记录表格已保存并回读校验：' + files.length + ' 个文件。')
  }
  async function previewTable(kind: 'records' | 'characters') {
    const selected = await port.openBackup({ kind: kind === 'records' ? 'record-table' : 'character-table' })
    if (selected.cancelled || !selected.base64 || !selected.name || !native) return
    setTablePreview({
      data: await importTable(snapshot, decodeBase64(selected.base64), selected.name, kind),
      revision: native.revision
    })
  }
  async function confirmTable() {
    if (!tablePreview || !native || native.revision !== tablePreview.revision)
      throw new Error('数据已变化，请重新选择表格。')
    await commit(tablePreview.data.next)
    setTablePreview(undefined)
    setNotice('表格数据已添加，安全副本已保存。')
  }
  async function runAutoBackup() {
    if (!native || busyLock.current || !native.archive.valid) return
    busyLock.current = true
    setBusy(true)
    try {
      const result = await port.automaticBackup({
        json: native.json ?? JSON.stringify(snapshot),
        expectedRevision: native.revision
      })
      setNative({ ...native, lastAutoBackupAt: result.savedAt })
      setNotice('自动备份已保存：' + result.document.name + (result.warning ? '。' + result.warning : ''))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '自动备份失败，请检查保存位置。')
    } finally {
      busyLock.current = false
      setBusy(false)
    }
  }
  useEffect(() => {
    const config = snapshot.settings.autoBackup
    if (!config?.enabled || !native?.archive.valid) return
    if (
      config.interval === 'idle' &&
      native.lastAutoBackupAt &&
      native.lastAutoBackupAt >= Date.parse(snapshot.exportedAt)
    )
      return
    const due =
      config.interval === 'idle'
        ? 1500
        : Math.max(
            1500,
            (native.lastAutoBackupAt ?? 0) + (config.interval === 'daily' ? 86400000 : 604800000) - Date.now()
          )
    let timer: ReturnType<typeof setTimeout>
    const attempt = () => {
      if (busyLock.current) timer = setTimeout(attempt, 1000)
      else void runAutoBackup()
    }
    timer = setTimeout(attempt, Math.min(due, 2147483647))
    return () => clearTimeout(timer)
  }, [snapshot, native?.revision, native?.archive.valid, native?.lastAutoBackupAt])
  const backHandler = useRef<() => void>(() => {})
  backHandler.current = () => {
    if (busyLock.current) {
      setNotice('操作进行中，请稍候。')
      return
    }
    if (preview) setPreview(undefined)
    else if (exportRequest) setExportRequest(undefined)
    else if (tablePreview) setTablePreview(undefined)
    else if (editing) window.dispatchEvent(new Event('logbook-editor-back'))
    else if (record) setRecord(undefined)
    else if (selectedCharacter) setSelectedCharacter('')
    else if (page !== 'records') setPage('records')
    else if (Capacitor.isNativePlatform()) void CapacitorApp.minimizeApp()
  }
  useEffect(() => {
    const browserBack = () => backHandler.current()
    window.addEventListener('logbook-back', browserBack)
    let disposed = false
    let remove: (() => Promise<void>) | undefined
    if (Capacitor.isNativePlatform())
      void CapacitorApp.addListener('backButton', browserBack).then((handle) => {
        if (disposed) void handle.remove()
        else remove = () => handle.remove()
      })
    let removeResume: (() => Promise<void>) | undefined
    if (Capacitor.isNativePlatform())
      void CapacitorApp.addListener('appStateChange', (state) => {
        if (state.isActive && !busyLock.current) void perform(reload)
      }).then((handle) => {
        if (disposed) void handle.remove()
        else removeResume = () => handle.remove()
      })
    return () => {
      disposed = true
      window.removeEventListener('logbook-back', browserBack)
      void remove?.()
      void removeResume?.()
    }
  }, [])
  function startEdit(draft: Edit) {
    if (native && !busyLock.current) setEditing({ draft, revision: native.revision })
  }
  function newModule() {
    startEdit({
      kind: 'module',
      value: {
        id: crypto.randomUUID(),
        name: '',
        playStatus: 'not_started',
        kps: [],
        pairs: [],
        order: snapshot.modules.length,
        collapsed: false,
        createdAt: '',
        updatedAt: ''
      }
    })
  }
  function newRecord(sourceType: 'manual' | 'online' = 'manual') {
    startEdit({
      kind: 'record',
      value: {
        id: crypto.randomUUID(),
        name: '',
        moduleId: snapshot.modules[0]?.id ?? '',
        sequenceNo: 0,
        sourceType,
        status: sourceType === 'manual' ? 'manual' : 'pending',
        dateSource: 'none',
        manualContent: sourceType === 'manual' ? '' : undefined,
        order: snapshot.records.length,
        createdAt: '',
        updatedAt: ''
      }
    })
  }
  async function persistEdit(draft: Edit) {
    if (!editing || busyLock.current) return
    busyLock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await saveEdit(port, snapshot, draft, editing.revision)
      setEditing(undefined)
      setRecord(undefined)
      setNotice('修改已保存。安全副本：' + result.safetyBackup.name)
      try {
        await reload()
      } catch {
        setError('修改已提交，但页面重新读取失败。请重新打开应用读取，勿重复保存。')
      }
    } finally {
      busyLock.current = false
      setBusy(false)
    }
  }

  /** @returns 当前存储与授权；读取失败保留旧显示，不重置数据库。 */
  async function reload() {
    const state = await port.getState()
    const data = state.json
      ? (await previewBackup(new TextEncoder().encode(state.json))).snapshot
      : emptySnapshot()
    setSnapshot(data)
    setNative(state)
    document.documentElement.dataset.theme = data.settings.theme
  }
  /**
   * 串行化用户操作并显示失败，防止重复点击并发覆盖。
   * @param action - 一个完整操作，不读取其他应用数据。
   * @returns 无返回值；失败展示错误且不宣称保存成功。
   */
  async function perform(action: () => Promise<void>) {
    if (busyLock.current) return
    busyLock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请重试。')
    } finally {
      busyLock.current = false
      setBusy(false)
    }
  }
  useEffect(() => {
    void perform(reload)
  }, [])

  /** @returns 打开系统目录选择；取消不将首次配置标为成功。 */
  async function chooseArchive() {
    const choice = await port.selectArchive()
    if (choice.cancelled) {
      setNotice('尚未确认新位置；原位置保持不动。')
      return
    }
    await reload()
    setNotice('归档位置已确认，并通过读写校验。')
  }
  /** @returns 仅生成预览，不在文件选择后自动恢复。 */
  async function chooseBackup() {
    const choice = await port.openBackup()
    if (choice.cancelled || !choice.base64) return
    setPreview(await previewBackup(decodeBase64(choice.base64)))
  }
  /**
   * 用户点击确认后生成安全副本，再在事务内覆盖。
   * @param restoreSettings - 是否恢复主题及阅读过滤项，不恢复保存路径。
   * @returns 无返回值；失败保留预览供用户处理。
   */
  async function confirmRestore(restoreSettings: boolean) {
    if (!preview || !native) throw new Error('预览已失效，请重新选择备份。')
    const result = await restoreBackup(port, preview, {
      confirmed: true,
      restoreSettings,
      revision: native.revision,
      current: snapshot
    })
    setPreview(undefined)
    setRecord(undefined)
    await reload()
    setPage('records')
    setNotice(`导入完成。恢复前安全备份：${result.safetyBackup.name}`)
  }
  /** @returns 保存含已获取正文的安卓备份；不冒充已兼容旧电脑版的整库格式。 */
  async function exportBackup(includeArchives = false) {
    let bytes = encodeBackup(snapshot)
    if (includeArchives) {
      const known = (await port.listDocuments({ all: true })).documents
      const exported = known.filter(
        (file) =>
          file.purpose === 'export' ||
          file.purpose === 'import' ||
          (!file.purpose && !/^(before-|auto-backup-|coc-android-backup-)/.test(file.name))
      )
      const files = []
      let total = 0
      for (const file of exported) {
        total += file.bytes
        if (total > 128 * 1024 * 1024) throw new Error('归档附件超过 128 MB，无法打包。原文件保留。')
        const content = await port.readDocument({ uri: file.uri })
        files.push({ name: content.name, bytes: decodeBase64(content.base64) })
      }
      bytes = await encodeArchiveBackup(snapshot, files)
    }
    const file = await port.writeArchive({
      name: 'coc-android-backup-' + Date.now() + (includeArchives ? '.zip' : '.json'),
      mime: includeArchives ? 'application/zip' : 'application/json',
      base64: encodeBase64(bytes),
      purpose: 'backup'
    })
    setSavedDocument(file)
    setNotice(`备份已保存并回读校验：${file.name}`)
  }
  async function changeTheme(theme: 'light' | 'dark') {
    if (!native || theme === snapshot.settings.theme) return
    const next = {
      ...snapshot,
      exportedAt: new Date().toISOString(),
      settings: { ...snapshot.settings, theme }
    }
    const result = await port.commitEdit({ json: JSON.stringify(next), expectedRevision: native.revision })
    setSnapshot(next)
    setNative({ ...native, json: JSON.stringify(next), revision: result.revision })
    document.documentElement.dataset.theme = theme
    setNotice(theme === 'dark' ? '已保存深色主题。' : '已保存浅色主题。')
  }
  /**
   * 使用桌面现有过滤/文本渲染逻辑导出单场次。
   * @param target - 用户当前阅读的场次。
   * @param filters - 当前阅读器过滤选项。
   * @returns 无返回值，成功显示实际文档名。
   */
  async function exportText(target: SessionRecord, filters: FilterPreset) {
    const text = target.rawContent ? renderLogText(target.rawContent, filters) : target.manualContent
    if (text === undefined) throw new Error('此场次没有已保存正文，不能导出。')
    const name =
      Array.from(target.name)
        .map((c) => (c.charCodeAt(0) < 32 ? '_' : c))
        .join('')
        .replace(/[\\/:*?"<>|.]/g, '_')
        .slice(0, 60) || '场次'
    const file = await port.writeArchive({
      name: `${name}.txt`,
      mime: 'text/plain',
      base64: encodeBase64(new TextEncoder().encode(text))
    })
    setSavedDocument(file)
    setNotice(`TXT 已保存并回读校验：${file.name}`)
  }
  const titles = {
    records: '跑团记录汇总',
    characters: '角色卡',
    settings: '数据与设置'
  }
  return (
    <div className="mobile-shell">
      <header className="app-header">
        <img src="icon.png" alt="" />
        <div>
          <strong>COC 跑团记录簿</strong>
          <span>安卓开发版 · 本机数据</span>
        </div>
        <span className="version">0.2.1</span>
      </header>
      <main>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {savedDocument && (
          <section className="panel">
            <p>最近保存：{savedDocument.name}</p>
            <button
              disabled={busy}
              onClick={() => void perform(() => port.openDocument({ uri: savedDocument.uri }))}
            >
              打开文件
            </button>
            <button
              disabled={busy}
              onClick={() => void perform(() => port.shareDocument({ uri: savedDocument.uri }))}
            >
              分享文件
            </button>
          </section>
        )}
        {!native ? (
          <section className="panel">
            <h1>准备本机数据</h1>
            <p>{busy ? '正在读取…' : '尚未读取成功。不会自动清空任何数据。'}</p>
            <button disabled={busy} onClick={() => void perform(reload)}>
              重新读取
            </button>
          </section>
        ) : !native.archive.valid ? (
          <ArchiveGate
            busy={busy}
            label={native.archive.label}
            onChoose={() => void perform(chooseArchive)}
          />
        ) : (
          <>
            <div className="page-heading">
              {testBackup && !editing && !record && (
                <section className="panel sample-help">
                  <h2>公开搜索测试数据</h2>
                  <p>
                    2 个模组、4 个场次，含 240
                    条跨页正文和手动笔记。载入会先预览，确认后覆盖当前测试数据并保留安全副本。
                  </p>
                  <button
                    disabled={busy || !!preview}
                    onClick={() => void perform(async () => setPreview(await previewBackup(testBackup())))}
                  >
                    载入公开测试数据
                  </button>
                  <p className="muted">
                    打开“第一场：灯塔线索”，搜索“灯塔”可测试三页跳转；搜索“a+b”可测试符号。手动笔记可搜索“铜钥匙”。
                  </p>
                </section>
              )}
              <p className="eyebrow">仅保留你确认的三个模块</p>
              <h1>{titles[page]}</h1>
            </div>
            {editing ? (
              <Editor
                initial={editing.draft}
                snapshot={snapshot}
                busy={busy}
                onSave={persistEdit}
                onClose={() => setEditing(undefined)}
              />
            ) : (
              <>
                {page === 'records' &&
                  (record ? (
                    <LogReader
                      key={record.id}
                      record={record}
                      preset={snapshot.settings.filterPreset}
                      busy={busy}
                      onBack={() => setRecord(undefined)}
                      onEdit={() => startEdit({ kind: 'record', value: record })}
                      onFetch={() => void perform(() => probe([record.id]))}
                      onReset={() => void perform(() => act({ type: 'reset', id: record.id }))}
                      onExport={(filters) => void perform(() => exportText(record, filters))}
                      onExportMore={(filters) =>
                        setExportRequest({ ids: [record.id], combined: false, filters })
                      }
                    />
                  ) : (
                    <Records
                      snapshot={snapshot}
                      onNewModule={newModule}
                      onNewRecord={() => newRecord()}
                      onNewOnline={() => newRecord('online')}
                      onAction={(action) => void perform(() => act(action))}
                      onFetch={(ids) => void perform(() => probe(ids))}
                      onExport={(ids, combined) =>
                        setExportRequest({ ids, combined, filters: snapshot.settings.filterPreset })
                      }
                      busy={busy}
                      onEditModule={(value) => startEdit({ kind: 'module', value })}
                      onRead={setRecord}
                      onImport={() => {
                        setPage('settings')
                      }}
                    />
                  ))}
                {page === 'characters' && (
                  <CharacterCards
                    busy={busy}
                    characters={snapshot.characters}
                    selected={selectedCharacter}
                    onSelect={setSelectedCharacter}
                    onDelete={(id) => void perform(() => act({ type: 'delete', kind: 'character', id }))}
                    onEdit={(value) => startEdit({ kind: 'character', value })}
                    onNew={(edition) =>
                      startEdit({
                        kind: 'character',
                        value: createEmptyCharacter({ edition })
                      })
                    }
                  />
                )}
                {page === 'settings' && (
                  <DataSettings
                    archive={native.archive}
                    snapshot={snapshot}
                    busy={busy}
                    onChoose={() => void perform(chooseArchive)}
                    onImport={() => void perform(chooseBackup)}
                    onBackup={() => void perform(exportBackup)}
                    onZipBackup={() => void perform(() => exportBackup(true))}
                    onTheme={(theme) => void perform(() => changeTheme(theme))}
                    onSettings={(settings) => {
                      const before = snapshot
                      const next = { ...snapshot, settings: { ...snapshot.settings, ...settings } }
                      setSnapshot(next)
                      void perform(async () => {
                        try {
                          await commit(next)
                          setNotice('设置已保存。')
                        } catch (reason) {
                          setSnapshot(before)
                          throw reason
                        }
                      })
                    }}
                    onAutoBackup={() => void runAutoBackup()}
                    lastAutoBackupAt={native.lastAutoBackupAt}
                    onClear={() => void perform(() => act({ type: 'clear' }))}
                    onTableExport={(format) => void perform(() => exportTables(format))}
                    onTableImport={() => void perform(() => previewTable('records'))}
                    documents={documents}
                    onListDocuments={() =>
                      void perform(async () => setDocuments((await port.listDocuments()).documents))
                    }
                    onOpenDocument={(uri) => void perform(() => port.openDocument({ uri }))}
                    onShareDocument={(uri) => void perform(() => port.shareDocument({ uri }))}
                  />
                )}
              </>
            )}
          </>
        )}
      </main>
      <nav className="bottom-nav" aria-label="主导航">
        {(['records', 'characters', 'settings'] as const).map((tab) => (
          <button
            key={tab}
            disabled={busy || !!editing || !native?.archive.valid}
            aria-current={page === tab ? 'page' : undefined}
            className={page === tab ? 'active' : ''}
            onClick={() => {
              setPage(tab)
              setRecord(undefined)
              setSelectedCharacter('')
            }}
          >
            <span className="nav-icon">
              <NavIcon page={tab} />
            </span>
            {tab === 'records' ? '跑团记录' : tab === 'characters' ? '角色卡' : '数据与设置'}
          </button>
        ))}
      </nav>
      {preview && (
        <RestoreDialog
          preview={preview}
          busy={busy}
          currentRecords={snapshot.records.length}
          onCancel={() => setPreview(undefined)}
          onConfirm={(restoreSettings) => void perform(() => confirmRestore(restoreSettings))}
        />
      )}
      {exportRequest && (
        <ExportDialog
          count={exportRequest.ids.length}
          combined={exportRequest.combined}
          busy={busy}
          onClose={() => setExportRequest(undefined)}
          onExport={(format) => void perform(() => exportSelected(format))}
        />
      )}
      {tablePreview && (
        <div className="modal-backdrop">
          <section className="restore-dialog panel" role="dialog" aria-modal="true" aria-label="表格导入预览">
            <h2>表格导入预览</h2>
            <p>新增 {tablePreview.data.names.length} 项；当前业务数据保留。</p>
            {tablePreview.data.names.slice(0, 50).map((name, i) => (
              <p key={i}>{name}</p>
            ))}
            {tablePreview.data.warnings.map((warning, i) => (
              <p className="warning" key={i}>
                {warning}
              </p>
            ))}
            <div className="dialog-actions">
              <button disabled={busy} onClick={() => setTablePreview(undefined)}>
                取消
              </button>
              <button disabled={busy} onClick={() => void perform(confirmTable)}>
                确认添加表格数据
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
