import { useEffect, useRef, useState } from 'react'
import { DEFAULT_FILTER_PRESET } from '../../../src/shared/types'
import type { FilterPreset, SessionRecord } from '../../../src/shared/types'
import { renderLogText } from '../../../src/shared/document-renderer'
import { Native, decodeBase64, encodeBase64 } from '../data/native'
import type { LogbookPort, NativeState } from '../data/native'
import { encodeBackup, encodeArchiveBackup } from '../data/backup'
import { restoreBackup } from '../data/restore'
import type { ImportPreview, MobileSnapshot } from '../data/types'
import { Records } from './components/Records'
import { useNavigationGestures } from './useNavigationGestures'
import { CharacterCards } from './components/CharacterCards'
import { DataSettings } from './components/DataSettings'
import { ArchiveGate } from './components/ArchiveGate'
import { RestoreDialog } from './components/RestoreDialog'
import { LogReader } from './components/LogReader'
import { Editor } from './components/Editor'
import { ConfirmDialog } from './components/ConfirmDialog'
import { saveEdit } from '../data/edit'
import { validateSettings } from '../data/settings'
import { automaticBackupDelay } from '../data/automatic-backup'
import type { Edit } from '../data/edit'
import { createEmptyCharacter } from '../../../src/shared/coc-rules'
import { NavIcon } from './components/NavIcon'
import { SystemMessage } from './components/SystemMessage'
import { RemoveButton } from './components/RemoveButton'
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
import {
  prepareInBackground,
  previewBase64InBackground,
  previewInBackground,
  readInBackground,
  serializeInBackground
} from '../data/background'
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
  const nativeRef = useRef(native)
  nativeRef.current = native
  const [snapshot, setSnapshot] = useState<MobileSnapshot>(emptySnapshot)
  const [page, setPage] = useState<'records' | 'characters' | 'settings'>('records')
  const [record, setRecord] = useState<SessionRecord>()
  const [readerQuery, setReaderQuery] = useState('')
  const [moduleQueries, setModuleQueries] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<ImportPreview>()
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const confirmationResolver = useRef<((confirmed: boolean) => void) | undefined>(undefined)
  useEffect(() => () => confirmationResolver.current?.(false), [])
  /** @param message - 用户确认前的操作说明。 @returns 用户确认时 resolve true；取消、重复请求或卸载时为 false。 */
  function confirmOperation(message: string): Promise<boolean> {
    if (confirmationResolver.current) return Promise.resolve(false)
    return new Promise((resolve) => {
      confirmationResolver.current = resolve
      setConfirmation(message)
    })
  }
  /** @param confirmed - 本次确认选择。 @returns 无返回值；先关闭单一弹窗，再继续原操作。 */
  function resolveConfirmation(confirmed: boolean) {
    const resolve = confirmationResolver.current
    confirmationResolver.current = undefined
    setConfirmation('')
    resolve?.(confirmed)
  }
  const busyLock = useRef(false)
  const autoBackupLock = useRef(false)
  const [backingUp, setBackingUp] = useState(false)
  const [notice, setNotice] = useState('')
  const [quietSaving, setQuietSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
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
    setNotice('正在后台校验并编码待保存数据…')
    const prepared = await prepareInBackground({ ...next, exportedAt: new Date().toISOString() })
    const validated = prepared.snapshot
    setNotice('正在保存数据，请保持应用打开…')
    const result = await port.commitEdit({
      json: prepared.json,
      expectedRevision: native.revision
    })
    setSnapshot(validated)
    setNative((current) => current && { ...current, json: prepared.json, revision: result.revision })
    document.documentElement.dataset.theme = validated.settings.theme
  }
  /**
   * 确认危险操作后发送轻量列表命令；安全提交失败时维持当前数据。
   * @param action - 明确的排序、删除或其他列表动作。
   * @returns 无返回值；成功后仅更新列表快照及原生版本。
   */
  async function act(action: DataAction) {
    if (action.type === 'delete' || action.type === 'clear' || action.type === 'delete-records') {
      const description =
        action.type === 'delete-records'
          ? `批量删除已选 ${action.ids.length} 个场次及其已保存正文？未选场次、模组和角色卡会保留。`
          : action.type === 'clear'
            ? '清空全部模组、场次和角色卡？归档文件会保留。'
            : action.kind === 'module'
              ? '删除此模组及其全部场次？角色卡会保留并解除此模组归属。'
              : action.kind === 'character'
                ? '删除此角色卡？参与者姓名会保留，角色关联会解除。'
                : '删除此场次及已保存正文？'
      if (!(await confirmOperation(description))) return
    }
    if (!native) throw new Error('本机数据尚未读取。')
    const next = await applyAction(snapshot, action)
    const before = snapshot
    // 先展示待保存的列表位置，但不解锁第二次写入；安全提交失败必须回到原列表。
    setSnapshot(next)
    setNotice(action.type === 'reorder' ? '正在保存排序…' : '正在保存操作…')
    let result: Awaited<ReturnType<LogbookPort['commitAction']>>
    try {
      result = await port.commitAction({ action, expectedRevision: native.revision })
    } catch (reason) {
      setSnapshot(before)
      setNotice('本次操作未保存，列表已恢复。')
      throw new Error(
        '本次操作未保存，列表已恢复。' + (reason instanceof Error ? reason.message : '请重新读取。')
      )
    }
    // 安全提交后确认时间/版本；失效的大 JSON 缓存不用于自动备份。
    setSnapshot({ ...next, exportedAt: result.exportedAt })
    setNative((current) => current && { ...current, json: null, revision: result.revision })
    if (action.type === 'delete' || action.type === 'clear' || action.type === 'delete-records') {
      setRecord((current) => current && next.records.find((item) => item.id === current.id))
      setSelectedCharacter((current) => (next.characters.some((item) => item.id === current) ? current : ''))
    }
    setNotice(action.type === 'reorder' ? '排序已保存。' : '操作已保存。')
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
    const summary =
      '获取完成：' + (ids.length - failures) + ' 个成功，' + failures + ' 个失败。已有正文在失败时保留。'
    if (failures) setError(summary)
    else setNotice(summary)
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
    setNotice('表格数据已添加并保存。')
  }
  async function runAutoBackup(manual = false) {
    const started = nativeRef.current
    if (!started || busyLock.current || autoBackupLock.current || !started.archive.valid) return
    autoBackupLock.current = true
    setBackingUp(true)
    try {
      const result = await port.automaticBackup({
        expectedRevision: started.revision
      })
      setNative((current) =>
        current && current.archive.uri === started.archive.uri
          ? { ...current, lastAutoBackupAt: result.savedAt, lastAutoBackupRevision: result.revision }
          : current
      )
      if (manual)
        setNotice('自动备份已保存：' + result.document.name + (result.warning ? '。' + result.warning : ''))
      else if (result.warning) setError(result.warning)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '自动备份失败，请检查保存位置。')
    } finally {
      autoBackupLock.current = false
      setBackingUp(false)
    }
  }
  useEffect(() => {
    if (!native?.archive.valid) return
    const due = automaticBackupDelay(
      snapshot,
      native.lastAutoBackupAt,
      Date.now(),
      native.revision,
      native.lastAutoBackupRevision
    )
    if (due === undefined) return
    let timer: ReturnType<typeof setTimeout>
    const attempt = () => {
      if (busyLock.current || autoBackupLock.current) timer = setTimeout(attempt, 1000)
      else void runAutoBackup()
    }
    timer = setTimeout(attempt, Math.min(due, 2147483647))
    return () => clearTimeout(timer)
  }, [
    snapshot,
    native?.revision,
    native?.archive.valid,
    native?.lastAutoBackupAt,
    native?.lastAutoBackupRevision
  ])
  const backHandler = useRef<() => void>(() => {})
  useNavigationGestures(() => backHandler.current(), requestHome)
  /** @returns 无返回值；回桌面仅后台化，不清除草稿；写入期间拒绝应用内退出。 */
  function requestHome() {
    window.dispatchEvent(new Event('logbook-gesture-reset'))
    if (busyLock.current) {
      setNotice('数据正在处理，请完成后再返回桌面。')
      return
    }
    if (Capacitor.isNativePlatform()) void CapacitorApp.minimizeApp()
    else if (process.env.NODE_ENV === 'development')
      setNotice('浏览器预览：已请求返回手机桌面，草稿和数据未清除。')
  }
  backHandler.current = () => {
    if (confirmationResolver.current) {
      resolveConfirmation(false)
      return
    }
    // 先关闭应用内下拉；第二次返回才进入原有编辑/导出保护逻辑。
    if (document.querySelector('[data-app-dropdown]')) {
      window.dispatchEvent(new Event('logbook-dropdown-close'))
      return
    }
    if (busyLock.current && (editing || preview || exportRequest || tablePreview)) {
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
        window.dispatchEvent(new Event('logbook-gesture-reset'))
        if (state.isActive) void checkForeground()
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
  /** @returns 无返回值；回前台只检查版本和授权，原数据/草稿未变时不重读或弹提示。 */
  async function checkForeground() {
    if (busyLock.current) return
    try {
      const current = nativeRef.current
      const status = await port.getStatus()
      if (busyLock.current || !current || nativeRef.current !== current) return
      if (status.revision !== current.revision) {
        if (!document.querySelector('.editor')) await perform(reload, true)
        // 草稿仍基于旧快照，不能把新版本序号配给旧数据；保存时应拒绝陈旧覆盖。
        else
          setNative({
            ...current,
            archive: status.archive,
            lastAutoBackupAt: status.lastAutoBackupAt,
            lastAutoBackupRevision: status.lastAutoBackupRevision
          })
      } else setNative({ ...current, ...status })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存位置检查失败。')
    }
  }
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
  /**
   * 建立空名称草稿，序号接续本模组当前最大值，不重排已有场次。
   * @param moduleId - 已存在的归属模组。
   * @param sourceType - 手动正文或在线日志来源。
   * @returns 无返回值；打开受保护的编辑页。
   */
  function newRecord(moduleId: string, sourceType: 'manual' | 'online' = 'manual') {
    if (!snapshot.modules.some((module) => module.id === moduleId)) return
    startEdit({
      kind: 'record',
      value: {
        id: crypto.randomUUID(),
        name: '',
        moduleId,
        sequenceNo:
          snapshot.records
            .filter((r) => r.moduleId === moduleId)
            .reduce((maximum, r) => Math.max(maximum, r.sequenceNo), 0) + 1,
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
  /**
   * 提交草稿并复用已校验候选；普通编辑使用按钮/页内状态，来源变化保留明确进度。
   * @param draft - 编辑页的完整草稿；存储拒绝时不关闭编辑或展示成功。
   * @returns 无返回值；失败交回编辑页显示并保留草稿。
   */
  async function persistEdit(draft: Edit) {
    if (!editing || busyLock.current) return
    busyLock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    const previous =
      draft.kind === 'record' ? snapshot.records.find((row) => row.id === draft.value.id) : undefined
    const quiet =
      !previous ||
      draft.kind !== 'record' ||
      (previous.sourceType === draft.value.sourceType && previous.link === draft.value.link)
    setQuietSaving(quiet)
    setSaveStatus(quiet ? '保存中…' : '')
    if (!quiet) setNotice('正在保存变更…')
    try {
      const result = await saveEdit(port, snapshot, draft, editing.revision)
      setSnapshot(result.snapshot)
      setNative((current) => current && { ...current, json: result.json, revision: result.revision })
      setEditing(undefined)
      setRecord(undefined)
      if (quiet) setSaveStatus('已保存')
      else setNotice('修改已保存。')
    } catch (reason) {
      setSaveStatus('')
      throw reason
    } finally {
      setQuietSaving(false)
      busyLock.current = false
      setBusy(false)
    }
  }

  /** @returns 当前存储与授权；读取失败保留旧显示，不重置数据库。 */
  async function reload() {
    const state = await port.getState()
    setNotice('正在后台读取并校验本机数据…')
    const data = state.json ? await readInBackground(state.json) : emptySnapshot()
    setSnapshot(data)
    setNative(state)
    document.documentElement.dataset.theme = data.settings.theme
    setNotice('')
  }
  /**
   * 串行化用户操作并显示失败，防止重复点击并发覆盖。
   * @param action - 一个完整操作，不读取其他应用数据。
   * @param quiet - 普通保存使用页内小状态；重要操作仍展示阶段进度。
   * @returns 无返回值；失败展示错误且不宣称保存成功。
   */
  async function perform(action: () => Promise<void>, quiet = false) {
    if (busyLock.current) return
    busyLock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    setQuietSaving(quiet)
    setSaveStatus(quiet ? '保存中…' : '')
    try {
      await action()
      if (quiet) {
        setNotice('')
        setSaveStatus('已保存')
      }
    } catch (reason) {
      setSaveStatus('')
      setError(reason instanceof Error ? reason.message : '操作失败，请重试。')
      setNotice((current) =>
        current.startsWith('正在') || current.startsWith('请选择') ? '操作未完成，请查看错误提示。' : current
      )
    } finally {
      setQuietSaving(false)
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
    setNotice('请选择备份文件；读取后将进行后台校验…')
    const choice = await port.openBackup()
    if (choice.cancelled || !choice.base64) {
      setNotice('已取消选择备份，当前数据未改变。')
      return
    }
    setNotice('正在后台解码和校验备份，尚未写入数据…')
    setPreview(await previewBase64InBackground(choice.base64))
    setNotice('备份校验完成；请核对并确认，尚未覆盖当前数据。')
  }
  /**
   * 用户点击确认后在事务内覆盖，不创建操作前副本。
   * @param restoreSettings - 是否恢复主题及阅读过滤项，不恢复保存路径。
   * @returns 无返回值；失败保留预览供用户处理。
   */
  async function confirmRestore(restoreSettings: boolean) {
    if (!preview || !native) throw new Error('预览已失效，请重新选择备份。')
    setNotice('正在准备安全导入，尚未覆盖数据…')
    // 先让确认弹窗的阶段与禁用状态实际绘制，再处理大对象或调用原生桥。
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    await restoreBackup(port, preview, {
      confirmed: true,
      restoreSettings,
      revision: native.revision,
      current: snapshot,
      serialize: async (value) => {
        setNotice('正在后台编码完整导入数据…')
        const json = await serializeInBackground(value)
        setNotice('正在导入数据，请保持应用打开…')
        return json
      }
    })
    setPage('records')
    setPreview(undefined)
    setRecord(undefined)
    await reload()
    setNotice('导入完成。')
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
  /**
   * 只把完整小设置送过桥；提交成功后更新版本，失败恢复原设置。
   * @param changes - 来自设置页的字段变化，不包含场次正文或目录。
   * @returns 无返回值；只有原生事务确认后才能展示“已保存”。
   */
  async function persistSettings(changes: Partial<MobileSnapshot['settings']>) {
    if (!native) throw new Error('本机数据尚未读取。')
    const before = snapshot
    const settings = validateSettings({ ...snapshot.settings, ...changes })
    setSnapshot({ ...snapshot, settings })
    document.documentElement.dataset.theme = settings.theme
    try {
      const result = await port.commitSettings({ settings, expectedRevision: native.revision })
      setSnapshot({ ...snapshot, settings, exportedAt: result.exportedAt })
      setNative((current) => current && { ...current, json: null, revision: result.revision })
    } catch (reason) {
      setSnapshot(before)
      document.documentElement.dataset.theme = before.settings.theme
      throw reason
    }
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
  const atHome =
    !editing &&
    !preview &&
    !tablePreview &&
    !exportRequest &&
    !record &&
    !selectedCharacter &&
    page === 'records'
  return (
    <div className="mobile-shell">
      <div className="app-edge-zone left" data-navigation-zone="left" aria-hidden="true" />
      <div className="app-edge-zone right" data-navigation-zone="right" aria-hidden="true" />
      <div className="app-home-zone" data-navigation-zone="home" aria-hidden="true" />
      <header className="app-header">
        <button
          type="button"
          className="app-back"
          aria-label={atHome && Capacitor.isNativePlatform() ? '返回手机桌面' : '返回上一页'}
          disabled={atHome && !Capacitor.isNativePlatform()}
          onClick={() => backHandler.current()}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <img src="icon.png" alt="" />
        <div>
          <strong>COC 跑团记录簿</strong>
          <span>安卓开发版 · 本机数据</span>
        </div>
        <span className="version">0.2.14</span>
      </header>
      <main aria-hidden={confirmation ? true : undefined}>
        {savedDocument && (
          <section className="panel">
            <div className="recent-saved-title">
              <p>最近保存：{savedDocument.name}</p>
              <RemoveButton label="关闭最近保存" onClick={() => setSavedDocument(undefined)} />
            </div>
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
                    2 个模组、4 个场次，含 240 条跨页正文和手动笔记。载入会先预览，确认后覆盖当前测试数据。
                  </p>
                  <button
                    disabled={busy || !!preview}
                    onClick={() =>
                      void perform(async () => setPreview(await previewInBackground(testBackup())))
                    }
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
              {!editing && saveStatus && (
                <span className="inline-save-status" role="status" aria-label="普通保存状态">
                  {saveStatus}
                </span>
              )}
            </div>
            {editing ? (
              <Editor
                initial={editing.draft}
                snapshot={snapshot}
                busy={busy}
                onSave={persistEdit}
                onClose={() => setEditing(undefined)}
                onConfirm={confirmOperation}
              />
            ) : (
              <>
                {page === 'records' &&
                  (record ? (
                    <LogReader
                      key={record.id}
                      record={record}
                      initialQuery={readerQuery}
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
                      onNewRecord={(moduleId) => newRecord(moduleId)}
                      onNewOnline={(moduleId) => newRecord(moduleId, 'online')}
                      onAction={(action) => void perform(() => act(action))}
                      onFetch={(ids) => void perform(() => probe(ids))}
                      onExport={(ids, combined) =>
                        setExportRequest({ ids, combined, filters: snapshot.settings.filterPreset })
                      }
                      busy={busy}
                      onEditModule={(value) => startEdit({ kind: 'module', value })}
                      queries={moduleQueries}
                      onQuery={(id, query) => setModuleQueries((current) => ({ ...current, [id]: query }))}
                      onRead={(value, query = '') => {
                        setReaderQuery(query)
                        setRecord(value)
                      }}
                      onImport={() => {
                        setPage('settings')
                      }}
                    />
                  ))}
                {page === 'characters' && (
                  <CharacterCards
                    busy={busy}
                    characters={snapshot.characters}
                    modules={snapshot.modules}
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
                    backingUp={backingUp}
                    onImport={() => void perform(chooseBackup)}
                    onBackup={() => void perform(exportBackup)}
                    onZipBackup={() => void perform(() => exportBackup(true))}
                    onTheme={(theme) => void perform(() => persistSettings({ theme }), true)}
                    onSettings={(settings) => void perform(() => persistSettings(settings), true)}
                    onAutoBackup={() => void runAutoBackup(true)}
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
      <div className="navigation-dock">
        <div className="operation-feedback">
          {busy && !quietSaving && !preview && !error && !confirmation && (
            <SystemMessage kind="progress" ariaLabel="数据处理进度" message={notice || '正在处理…'} />
          )}
          {error && !preview && (
            <SystemMessage
              kind="error"
              message={error}
              onDismiss={() => {
                setError('')
                setNotice('')
              }}
            />
          )}
          {notice && !busy && !preview && !error && (
            <SystemMessage message={notice} autoHide onDismiss={() => setNotice('')} />
          )}
        </div>
        <nav className="bottom-nav" aria-label="主导航">
          {(['records', 'characters', 'settings'] as const).map((tab) => (
            <button
              key={tab}
              disabled={!!editing || !native?.archive.valid}
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
      </div>
      {confirmation && <ConfirmDialog message={confirmation} onResolve={resolveConfirmation} />}
      {preview && (
        <RestoreDialog
          preview={preview}
          busy={busy}
          stage={notice}
          error={error}
          currentRecords={snapshot.records.length}
          onCancel={() => {
            setPreview(undefined)
            setNotice('已取消导入，当前数据未改变。')
          }}
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
            {tablePreview.data.names.map((name, i) => (
              <p key={i}>{name}</p>
            ))}
            {tablePreview.data.warnings.map((warning, i) => (
              <SystemMessage kind="warning" message={warning} key={i} />
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
