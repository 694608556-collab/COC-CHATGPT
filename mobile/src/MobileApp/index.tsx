import { useEffect, useRef, useState } from 'react'
import { DEFAULT_FILTER_PRESET } from '../../../src/shared/types'
import type { FilterPreset, SessionRecord } from '../../../src/shared/types'
import { renderLogText } from '../../../src/shared/document-renderer'
import { Native, decodeBase64, encodeBase64 } from '../data/native'
import type { LogbookPort, NativeState } from '../data/native'
import { previewBackup, encodeBackup } from '../data/backup'
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
export function MobileApp({ port = Native }: { port?: LogbookPort }) {
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
  function newRecord() {
    startEdit({
      kind: 'record',
      value: {
        id: crypto.randomUUID(),
        name: '',
        moduleId: snapshot.modules[0]?.id ?? '',
        sequenceNo: 0,
        sourceType: 'manual',
        status: 'manual',
        dateSource: 'none',
        manualContent: '',
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
  async function exportBackup() {
    const file = await port.writeArchive({
      name: `coc-android-backup-${Date.now()}.json`,
      mime: 'application/json',
      base64: encodeBase64(encodeBackup(snapshot))
    })
    setNotice(`备份已保存并回读校验：${file.name}`)
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
        <span className="version">0.1</span>
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
                      onExport={(filters) => void perform(() => exportText(record, filters))}
                    />
                  ) : (
                    <Records
                      snapshot={snapshot}
                      onNewModule={newModule}
                      onNewRecord={newRecord}
                      onEditModule={(value) => startEdit({ kind: 'module', value })}
                      onRead={setRecord}
                      onImport={() => {
                        setPage('settings')
                      }}
                    />
                  ))}
                {page === 'characters' && (
                  <CharacterCards
                    characters={snapshot.characters}
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
            }}
          >
            <span aria-hidden="true">{tab === 'records' ? '▤' : tab === 'characters' ? '◇' : '⚙'}</span>
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
    </div>
  )
}
