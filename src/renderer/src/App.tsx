
import { CharacterEditor } from './components/CharacterEditor'
import { useEffect, useState } from 'react'
import { BatchCheckDialog } from './components/BatchCheckDialog'
import { ConfirmDialog, type ConfirmOptions } from './components/ConfirmDialog'
import { RecordImportDialog } from './components/RecordImportDialog'
import appIcon from './assets/app-icon.png'
import { NoteBoard } from './components/NoteBoard'
import { FolderIcon, PencilIcon, PlusIcon, SolidTriangleIcon, XIcon } from './components/Icons'
import { mergeImportedParticipants, type TableImportRow } from '../../shared/table-import'
import { applyLogFilters } from '../../shared/log-filter'
import { searchModuleRecords, type ModuleSearchHit } from '../../shared/record-search'
import { skillFinal } from '../../shared/coc-rules'
import type { BackupPreviewApi } from '../../shared/api'
import {
  DEFAULT_FILTER_PRESET,
  MODULE_PLAY_STATUSES,
  MODULE_PLAY_STATUS_LABELS,
  type AppSnapshot,
  type CharacterData,
  type FilterPreset,
  type ModulePlayStatus,
  type ModuleRecord,
  type ParticipantPair,
  type SessionRecord
} from '../../shared/types'

type Page = 'records' | 'characters' | 'notes' | 'settings'

const pageMeta: Record<Page, { title: string; subtitle: (snapshot: AppSnapshot) => string }> = {
  records: {
    title: '跑团记录汇总',
    subtitle: (snapshot) => `模组 ${snapshot.modules.length} · 场次 ${snapshot.records.length}`
  },
  characters: { title: '调查员角色卡', subtitle: (snapshot) => `角色 ${snapshot.characters.length}` },
  notes: { title: '跑团闲记', subtitle: (snapshot) => `闲记 ${snapshot.notes.length}` },
  settings: { title: '数据与设置', subtitle: () => '全部数据仅保存在本机' }
}

interface ModuleDraft {
  id?: string
  name: string
  /** 新建时不预选，用户必须明确选择才能保存 */
  playStatus?: ModulePlayStatus
  kps: string[]
  pairs: ParticipantPair[]
}

interface RecordDraft {
  id?: string
  moduleId: string
  name: string
  link: string
  playDate: string
  manualContent: string
  sequenceNo?: number
}

interface SequencePickerState {
  moduleId: string
  moduleName: string
  used: number[]
  gaps: number[]
  next: number
}

type RecordExportFormat = 'raw' | 'doc' | 'dialogue-doc' | 'docx' | 'txt' | 'pdf'
type CombinedExportFormat = 'txt' | 'docx' | 'pdf'
type TableExportFormat = 'csv' | 'xlsx'
type ExportFormat = RecordExportFormat | TableExportFormat
type ExportAction = 'batch' | 'combine' | 'table'

function exportFormatLabel(format: ExportFormat): string {
  if (format === 'raw') return '\u539f\u59cb\u6587\u4ef6'
  if (format === 'doc') return '\u5e26\u56fe DOC'
  if (format === 'dialogue-doc') return '\u5bf9\u8bdd DOC'
  return format.toUpperCase()
}

function ExportDialog({
  action,
  selectedCount,
  onClose,
  onConfirm
}: {
  action: ExportAction
  selectedCount: number
  onClose(): void
  onConfirm(format: ExportFormat, scope: 'all' | 'selected'): void
}): React.JSX.Element {
  const [scope, setScope] = useState<'all' | 'selected'>(selectedCount ? 'selected' : 'all')
  const title = { batch: '批量下载', combine: '批量合成', table: '导出表格' }[action]
  const formats: ExportFormat[] =
    action === 'table'
      ? ['xlsx', 'csv']
      : action === 'combine'
        ? ['docx', 'txt', 'pdf']
        : ['raw', 'doc', 'dialogue-doc', 'docx', 'txt', 'pdf']
  return (
    <Modal title={title} onClose={onClose}>
      <div className="form-grid export-dialog">
        {action === 'table' && (
          <fieldset>
            <legend>导出范围</legend>
            <label className="radio-row">
              <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />
              全部模组与场次
            </label>
            <label className="radio-row">
              <input
                type="radio"
                checked={scope === 'selected'}
                disabled={!selectedCount}
                onChange={() => setScope('selected')}
              />
              已勾选场次（{selectedCount}）
            </label>
          </fieldset>
        )}
        <p className="muted">
          {action === 'combine'
            ? '按场次当前顺序合成为一个文件；无法使用的场次会列入结果。'
            : action === 'batch'
              ? `分别生成 ${selectedCount} 个场次文件。`
              : 'XLSX 会按模组分工作表；多模组 CSV 会打包为 ZIP。'}
        </p>
        <div className="format-options">
          {formats.map((format) => (
            <button className="primary" key={format} onClick={() => onConfirm(format, scope)}>
              导出 {format.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <footer className="modal-actions">
        <button className="secondary" onClick={onClose}>
          取消
        </button>
      </footer>
    </Modal>
  )
}

function BackupChoiceDialog({
  onClose,
  onSelect
}: {
  onClose(): void
  onSelect(includeArchives: boolean): void
}): React.JSX.Element {
  return (
    <Modal title="导出备份" onClose={onClose}>
      <div className="backup-choice">
        <button className="backup-option" onClick={() => onSelect(false)}>
          <strong>仅保存应用数据</strong>
          <span>生成 JSON，包含模组、场次、角色卡、设置与手动记录正文；不包含归档文件。</span>
        </button>
        <button className="backup-option" onClick={() => onSelect(true)}>
          <strong>保存应用数据及归档文件</strong>
          <span>生成 ZIP，仅包含应用已登记的归档文件；不会收集您自行放入的其他文件。</span>
        </button>
      </div>
      <footer className="modal-actions">
        <button className="secondary" onClick={onClose}>
          取消
        </button>
      </footer>
    </Modal>
  )
}

function RestorePreviewDialog({
  preview,
  onClose,
  onConfirm
}: {
  preview: BackupPreviewApi
  onClose(): void
  onConfirm(options: { restoreSettings: boolean }): void
}): React.JSX.Element {
  const [restoreSettings, setRestoreSettings] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  return (
    <Modal title="确认恢复备份" onClose={onClose}>
      <div className="form-grid">
        <p>备份时间：{new Date(preview.exportedAt).toLocaleString()}</p>
        <div className="restore-summary">
          <span>模组 {preview.modules}</span>
          <span>场次 {preview.records}</span>
          <span>角色卡 {preview.characters}</span>
          <span>归档文件 {preview.archiveFiles}</span>
        </div>
        <p className="muted">
          恢复会先为当前数据创建安全副本。在线日志缓存不会随备份恢复，之后可按需重新检测。
        </p>
        {preview.warnings.map((warning) => (
          <p className="warning-text" key={warning}>
            {warning}
          </p>
        ))}
        <label className="radio-row">
          <input
            type="checkbox"
            checked={restoreSettings}
            onChange={(event) => setRestoreSettings(event.target.checked)}
          />
          同时恢复主题、过滤预设等设置（归档路径仍使用当前电脑的位置）
        </label>
        <label className="radio-row">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          我知道这会替换当前的模组、场次和角色卡数据
        </label>
      </div>
      <footer className="modal-actions">
        <button className="secondary" onClick={onClose}>
          取消
        </button>
        <button className="primary" disabled={!acknowledged} onClick={() => onConfirm({ restoreSettings })}>
          确认恢复
        </button>
      </footer>
    </Modal>
  )
}

function ClearDataDialog({
  onClose,
  onConfirm
}: {
  onClose(): void
  onConfirm(options: {
    resetSettings: boolean
    clearMappings: boolean
    deleteRegisteredArchives: boolean
  }): void
}): React.JSX.Element {
  const [resetSettings, setResetSettings] = useState(false)
  const [clearMappings, setClearMappings] = useState(false)
  const [deleteRegisteredArchives, setDeleteRegisteredArchives] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  return (
    <Modal title="清空应用数据" onClose={onClose}>
      <div className="form-grid">
        <p className="warning-text">建议先导出备份。此操作会清空模组、场次、角色卡和缓存。</p>
        <label className="radio-row">
          <input
            type="checkbox"
            checked={resetSettings}
            onChange={(event) => setResetSettings(event.target.checked)}
          />
          同时恢复所有设置为默认值
        </label>
        <label className="radio-row">
          <input
            type="checkbox"
            checked={clearMappings}
            onChange={(event) => setClearMappings(event.target.checked)}
          />
          同时删除已保存的角色卡导入映射
        </label>
        <label className="radio-row">
          <input
            type="checkbox"
            checked={deleteRegisteredArchives}
            onChange={(event) => setDeleteRegisteredArchives(event.target.checked)}
          />
          同时删除应用已登记的归档文件
        </label>
        <p className="muted">即使选择删除，也不会删除您自行放入归档目录的文件或非空文件夹。</p>
        <label className="radio-row">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          我确认要清空应用数据
        </label>
      </div>
      <footer className="modal-actions">
        <button className="secondary" onClick={onClose}>
          取消
        </button>
        <button
          className="danger-button"
          disabled={!acknowledged}
          onClick={() => onConfirm({ resetSettings, clearMappings, deleteRegisteredArchives })}
        >
          清空数据
        </button>
      </footer>
    </Modal>
  )
}

const emptySnapshot: AppSnapshot = {
  schemaVersion: 1,
  exportedAt: '',
  modules: [],
  records: [],
  characters: [],
  notes: [],
  settings: {
    theme: 'light',
    archiveDirectory: '',
    filterPreset: {
      hideDiceCommands: false,
      hideImages: false,
      hideOffTopic: false,
      hideTime: false,
      hidePlatformAccount: true,
      hideYearMonthDay: true,
      indentFirstLine: false,
      darkDisplay: false
    },
    autoBackup: { enabled: true, interval: 'idle', retention: 10 }
  },
  importMappings: [],
  archiveEntries: []
}

function WindowControls(): React.JSX.Element {
  return (
    <div className="window-controls" aria-label="窗口控制">
      <button
        className="minimize"
        aria-label="最小化"
        title="最小化"
        onClick={() => void window.coc.window.minimize()}
      />
      <button
        className="maximize"
        aria-label="最大化或还原"
        title="最大化或还原"
        onClick={() => void window.coc.window.toggleMaximize()}
      />
      <button
        className="close"
        aria-label="关闭"
        title="关闭"
        onClick={() => void window.coc.window.close()}
      />
    </div>
  )
}

function Modal({
  title,
  children,
  onClose
}: {
  title: string
  children: React.ReactNode
  onClose(): void
}): React.JSX.Element {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭对话框" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

function ModuleEditor({
  draft,
  onChange,
  onCancel,
  onSave
}: {
  draft: ModuleDraft
  onChange(value: ModuleDraft): void
  onCancel(): void
  onSave(): void
}): React.JSX.Element {
  const updatePair = (index: number, field: 'pc' | 'pl', value: string): void => {
    const pairs = draft.pairs.map((pair, pairIndex) =>
      pairIndex === index ? { ...pair, [field]: value } : pair
    )
    onChange({ ...draft, pairs })
  }
  return (
    <Modal title={draft.id ? '编辑模组' : '新建模组'} onClose={onCancel}>
      <div className="form-grid">
        <div className="module-head-fields">
          <label>
            模组名
            <input
              autoFocus
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
              placeholder="例如：暗影循迹"
            />
          </label>
          <div className="field">
            <span className="field-label-text">跑团状态</span>
            <div className="play-status-picker" role="radiogroup" aria-label="跑团状态">
              {MODULE_PLAY_STATUSES.map((status) => (
                <button
                  type="button"
                  key={status}
                  role="radio"
                  aria-checked={draft.playStatus === status}
                  className={
                    draft.playStatus === status
                      ? `play-status-option selected play-status-${status}`
                      : `play-status-option play-status-${status}`
                  }
                  onClick={() => onChange({ ...draft, playStatus: status })}
                >
                  {MODULE_PLAY_STATUS_LABELS[status]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="participant-editor">
          <div className="field-label">KP（守密人）</div>
          {draft.kps.map((kp, index) => (
            <div className="kp-edit-row" key={index}>
              <span className="tag">KP</span>
              <input
                aria-label={`KP${index + 1}`}
                placeholder="守密人名称"
                value={kp}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    kps: draft.kps.map((item, i) => (i === index ? event.target.value : item))
                  })
                }
              />
              <button
                className="icon-button module-remove"
                aria-label={`删除 KP${index + 1}`}
                onClick={() =>
                  onChange({
                    ...draft,
                    kps: draft.kps.filter((_, i) => i !== index)
                  })
                }
              >
                <XIcon />
              </button>
            </div>
          ))}
          <button
            className="secondary add-participant"
            onClick={() =>
              onChange({
                ...draft,
                kps: [...draft.kps, '']
              })
            }
          >
            <PlusIcon /> 添加 KP
          </button>
        </div>
        <div className="pair-editor">
          <div className="field-label">PC / PL 成对名单</div>
          {draft.pairs.map((pair, index) => (
            <div className="pair-row" key={index}>
              <span>{index + 1}</span>
              <input
                aria-label={`PC${index + 1}`}
                placeholder="PC 角色名"
                value={pair.pc}
                onChange={(event) => updatePair(index, 'pc', event.target.value)}
              />
              <input
                aria-label={`PL${index + 1}`}
                placeholder="PL 玩家名"
                value={pair.pl}
                onChange={(event) => updatePair(index, 'pl', event.target.value)}
              />
              <button
                className="icon-button module-remove"
                aria-label={`删除 PC${index + 1} / PL${index + 1}`}
                onClick={() =>
                  onChange({
                    ...draft,
                    pairs: draft.pairs.filter((_, pairIndex) => pairIndex !== index)
                  })
                }
              >
                <XIcon />
              </button>
            </div>
          ))}
          <button
            className="secondary"
            onClick={() => onChange({ ...draft, pairs: [...draft.pairs, { pc: '', pl: '' }] })}
          >
            + 添加一对 PC / PL
          </button>
        </div>
      </div>
      <footer className="modal-actions">
        <button className="secondary" onClick={onCancel}>
          取消
        </button>
        <button className="primary" onClick={onSave}>
          保存模组
        </button>
      </footer>
    </Modal>
  )
}

function RecordEditor({
  draft,
  modules,
  onChange,
  onCancel,
  onSave
}: {
  draft: RecordDraft
  modules: ModuleRecord[]
  onChange(value: RecordDraft): void
  onCancel(): void
  onSave(): void
}): React.JSX.Element {
  return (
    <Modal title={draft.id ? '编辑场次' : '新增场次'} onClose={onCancel}>
      <div className="form-grid">
        <label>
          所属模组
          <select
            value={draft.moduleId}
            disabled={Boolean(draft.id)}
            onChange={(event) => onChange({ ...draft, moduleId: event.target.value })}
          >
            {modules.map((module) => (
              <option value={module.id} key={module.id}>
                {module.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          场次名称
          <input
            autoFocus
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            placeholder="留空时自动生成"
          />
        </label>
        <label>
          海豹完整网址
          <input
            value={draft.link}
            onChange={(event) => onChange({ ...draft, link: event.target.value })}
            placeholder="https://log.weizaima.com/?key=..."
          />
        </label>
        <label>
          跑团日期
          <input
            type="date"
            value={draft.playDate}
            onChange={(event) => onChange({ ...draft, playDate: event.target.value })}
          />
        </label>
        <label>
          手动记录正文
          <textarea
            rows={8}
            value={draft.manualContent}
            onChange={(event) => onChange({ ...draft, manualContent: event.target.value })}
            placeholder="没有链接时可直接粘贴正文；手动内容不会被在线内容覆盖。"
          />
        </label>
      </div>
      <footer className="modal-actions">
        <button className="secondary" onClick={onCancel}>
          取消
        </button>
        <button className="primary" onClick={onSave}>
          保存场次
        </button>
      </footer>
    </Modal>
  )
}

function SequencePickerDialog({
  moduleName,
  gaps,
  next,
  used,
  onClose,
  onConfirm
}: {
  moduleName: string
  gaps: number[]
  next: number
  used: number[]
  onClose(): void
  onConfirm(sequenceNo: number): void
}): React.JSX.Element {
  const [choice, setChoice] = useState<number>(next)
  const [custom, setCustom] = useState('')
  const [error, setError] = useState('')
  const usedSet = new Set(used)

  const choosePreset = (value: number): void => {
    setCustom('')
    setError('')
    setChoice(value)
  }

  const confirm = (): void => {
    if (custom.trim() !== '') {
      const value = Number(custom)
      if (!Number.isInteger(value) || value < 1) {
        setError('场次编号必须是大于 0 的整数')
        return
      }
      if (value > 9999) {
        setError('场次编号不能超过 9999')
        return
      }
      if (usedSet.has(value)) {
        setError(`第 ${value} 场已存在，请选择其他编号`)
        return
      }
      onConfirm(value)
      return
    }
    onConfirm(choice)
  }

  return (
    <Modal title="选择下一场编号" onClose={onClose}>
      <div className="sequence-picker">
        <p className="sequence-used">
          模组“{moduleName}”现有场次编号不连续（已有：{used.length ? used.join('、') : '无'}）。
          可以填补空缺编号，也可以接续最后编号。
        </p>
        <div className="sequence-options">
          {gaps.map((gap) => (
            <button
              type="button"
              key={gap}
              className={!custom && choice === gap ? 'backup-option selected' : 'backup-option'}
              onClick={() => choosePreset(gap)}
            >
              <strong>第 {gap} 场</strong>
              <span>填补编号空缺</span>
            </button>
          ))}
          <button
            type="button"
            className={!custom && choice === next ? 'backup-option selected' : 'backup-option'}
            onClick={() => choosePreset(next)}
          >
            <strong>第 {next} 场</strong>
            <span>接续最后编号</span>
          </button>
        </div>
        <label className="sequence-custom">
          自定义编号
          <input
            type="number"
            min={1}
            max={9999}
            value={custom}
            onChange={(event) => {
              setCustom(event.target.value)
              setError('')
            }}
            placeholder="1-9999"
          />
          <span>范围 1-9999，且不能与现有编号重复</span>
        </label>
        {error && <p className="sequence-error">{error}</p>}
      </div>
      <footer className="modal-actions">
        <button className="secondary" onClick={onClose}>
          取消
        </button>
        <button className="primary" onClick={confirm}>
          确认
        </button>
      </footer>
    </Modal>
  )
}

function statusLabel(status: SessionRecord['status']): string {
  return { pending: '待检测', valid: '有效', invalid: '失效', fetch_failed: '检测失败', manual: '手动内容' }[
    status
  ]
}

const filterLabels: Array<[keyof FilterPreset, string]> = [
  ['hideDiceCommands', '骰子指令过滤'],
  ['hideImages', '表情图片过滤'],
  ['hideOffTopic', '场外发言过滤'],
  ['hideTime', '时间显示过滤'],
  ['hidePlatformAccount', '平台账号隐藏'],
  ['hideYearMonthDay', '年月日不展示'],
]

function FilterEditor({
  value,
  onClose,
  onSave
}: {
  value: FilterPreset
  onClose(): void
  onSave(value: FilterPreset): void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  return (
    <Modal title="选项预设" onClose={onClose}>
      <div className="filter-list">
        {filterLabels.map(([key, label]) => (
          <button
            type="button"
            className={draft[key] ? 'filter-option active' : 'filter-option'}
            key={key}
            onClick={() => setDraft({ ...draft, [key]: !draft[key] })}
          >
            <span>{label}</span>
            <small>{draft[key] ? '已开启' : '未开启'}</small>
          </button>
        ))}
      </div>
      <footer className="modal-actions">
        <button className="secondary" onClick={() => setDraft({ ...DEFAULT_FILTER_PRESET })}>
          恢复默认
        </button>
        <button className="secondary" onClick={onClose}>
          取消
        </button>
        <button className="primary" onClick={() => onSave(draft)}>
          保存预设
        </button>
      </footer>
    </Modal>
  )
}

function RecordDetail({
  record,
  preset,
  onClose
}: {
  record: SessionRecord
  preset: FilterPreset
  onClose(): void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const messages = record.rawContent ? applyLogFilters(record.rawContent, preset) : []
  const source =
    record.manualContent || messages.map((message) => `${message.header}\n${message.text}`).join('\n\n')
  const matches = query ? source.toLocaleLowerCase().split(query.toLocaleLowerCase()).length - 1 : 0
  return (
    <Modal title={record.name} onClose={onClose}>
      <div className="detail-meta">
        <span>来源：{record.sourceType === 'manual' ? '手动内容' : '海豹日志'}</span>
        <span>状态：{statusLabel(record.status)}</span>
        <span>
          日期：{record.playDate || '日期未知'}（
          {record.dateSource === 'manual' ? '手动' : record.dateSource === 'parsed' ? '自动解析' : '未取得'}）
        </span>
        {record.fetchedAt && <span>最近抓取：{new Date(record.fetchedAt).toLocaleString()}</span>}
      </div>
      <div className="detail-search">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="在当前场次正文内搜索"
        />
        <span>{query ? `${matches} 处` : ''}</span>
      </div>
      <div className="log-preview">
        {record.manualContent ? (
          <p>{record.manualContent}</p>
        ) : messages.length ? (
          messages.map((message) => (
            <article key={message.id}>
              <strong>{message.header}</strong>
              <p>{message.text}</p>
              {message.images.map((image) => (
                <span className="image-reference" key={image.url}>
                  [图片] {image.url}
                </span>
              ))}
            </article>
          ))
        ) : (
          <div className="module-empty">尚无可预览正文，请先检测链接。</div>
        )}
      </div>
    </Modal>
  )
}

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('records')
  const [snapshot, setSnapshot] = useState<AppSnapshot>(emptySnapshot)
  const [appVersion, setAppVersion] = useState('')
  const [noteCreating, setNoteCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [windowMaximized, setWindowMaximized] = useState(false)
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions>()
  const [message, setMessage] = useState<string>()
  const [messageClosing, setMessageClosing] = useState(false)
  const [moduleDraft, setModuleDraft] = useState<ModuleDraft>()
  const [moduleSearch, setModuleSearch] = useState<Record<string, string>>({})
  const [recordDraft, setRecordDraft] = useState<RecordDraft>()
  const [sequencePicker, setSequencePicker] = useState<SequencePickerState>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filterOpen, setFilterOpen] = useState(false)
  const [tableImportOpen, setTableImportOpen] = useState(false)
  const [batchCheckOpen, setBatchCheckOpen] = useState(false)
  const [detailRecordId, setDetailRecordId] = useState<string>()
  const [exportAction, setExportAction] = useState<ExportAction>()
  const [characterId, setCharacterId] = useState<string>()
  const [backupChoiceOpen, setBackupChoiceOpen] = useState(false)
  const [restorePreview, setRestorePreview] = useState<BackupPreviewApi>()
  const [clearDataOpen, setClearDataOpen] = useState(false)
  const [cacheInfo, setCacheInfo] = useState<{ bytes: number; files: number }>({ bytes: 0, files: 0 })
  const [archiveStatus, setArchiveStatus] = useState<{ ok: boolean; reason?: string }>()

  const refresh = async (): Promise<void> => {
    const value = await window.coc.app.snapshot()
    setSnapshot(value)
    setAppVersion(await window.coc.app.version())
    document.documentElement.dataset.theme = value.settings.theme
    setCacheInfo(await window.coc.backup.cacheStats())
    // 归档目录可能因为换过 Windows 账户而失效，先探一次好让设置页给出提示
    try {
      setArchiveStatus(await window.coc.files.archiveStatus())
    } catch {
      setArchiveStatus(undefined)
    }
    setLoading(false)
  }

  // 全模组正文搜索：按模组当前输入的关键词，在该模组所有场次正文里查找
  const moduleSearchHits = (module: ModuleRecord): ModuleSearchHit[] => {
    const query = moduleSearch[module.id]?.trim()
    if (!query) return []
    return searchModuleRecords(
      snapshot.records.filter((record) => record.moduleId === module.id),
      query,
      snapshot.settings.filterPreset
    )
  }

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : '无法读取本地数据')
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!message) {
      setMessageClosing(false)
      return
    }
    setMessageClosing(false)
    const fadeTimer = window.setTimeout(() => setMessageClosing(true), 5000)
    const closeTimer = window.setTimeout(() => setMessage(undefined), 5550)
    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(closeTimer)
    }
  }, [message])

  useEffect(() => {
    const syncMaximized = (): void => {
      void window.coc.window.isMaximized().then(setWindowMaximized)
    }
    syncMaximized()
    window.addEventListener('resize', syncMaximized)
    return () => window.removeEventListener('resize', syncMaximized)
  }, [])

  const run = async (action: () => Promise<unknown>, success?: string): Promise<void> => {
    try {
      await action()
      await refresh()
      if (success) setMessage(success)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作未完成')
    }
  }

  const exportRecord = async (recordId: string, format: RecordExportFormat): Promise<void> => {
    try {
      const entry = await window.coc.files.exportRecord(recordId, format)
      await refresh()
      setMessage(`已保存：${entry.path}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出未完成')
    }
  }

  const createBackup = async (includeArchives: boolean): Promise<void> => {
    setBackupChoiceOpen(false)
    try {
      const result = await window.coc.backup.create(includeArchives)
      setMessage(`备份已保存：${result.path}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '备份生成失败')
    }
  }

  const chooseRestore = async (): Promise<void> => {
    try {
      const preview = await window.coc.backup.chooseRestore()
      if (preview) setRestorePreview(preview)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法读取备份')
    }
  }

  const executeExport = async (format: ExportFormat, scope: 'all' | 'selected'): Promise<void> => {
    if (!exportAction) return
    const ids = [...selected]
    const action = exportAction
    setExportAction(undefined)
    try {
      if (action === 'table') {
        const entry = await window.coc.files.exportTable(
          scope === 'selected' ? ids : undefined,
          format as TableExportFormat
        )
        setMessage(`表格已保存：${entry.path}`)
        try {
          await window.coc.files.showItem(entry.path)
        } catch {
          // 资源管理器打开失败不影响导出结果
        }
      } else if (action === 'batch') {
        const job = await window.coc.files.batchExport(ids, format as RecordExportFormat)
        const succeeded = job.results.filter((item) => item.state === 'success').length
        const failed = job.results.filter((item) => item.state === 'failed').length
        setMessage(`批量下载完成：成功 ${succeeded}，失败 ${failed}。`)
        try {
          await window.coc.files.openDirectory('archive')
        } catch {
          // 资源管理器打开失败不影响导出结果
        }
      } else {
        const grouped = new Map<string, string[]>()
        for (const recordId of ids) {
          const record = snapshot.records.find((item) => item.id === recordId)
          if (!record) continue
          const group = grouped.get(record.moduleId) ?? []
          group.push(recordId)
          grouped.set(record.moduleId, group)
        }
        const combinedResults = []
        for (const group of grouped.values()) {
          combinedResults.push(await window.coc.files.exportCombined(group, format as CombinedExportFormat))
        }
        const included = combinedResults.reduce((sum, item) => sum + item.included.length, 0)
        const failed = combinedResults.reduce((sum, item) => sum + item.failed.length, 0)
        setMessage(`合集已保存 ${combinedResults.length} 份；包含 ${included} 场，跳过 ${failed} 场。`)
        try {
          if (combinedResults.length === 1) {
            await window.coc.files.showItem(combinedResults[0]!.entry.path)
          } else {
            await window.coc.files.openDirectory('archive')
          }
        } catch {
          // 资源管理器打开失败不影响导出结果
        }
      }
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出未完成')
    }
  }

  const saveModule = async (): Promise<void> => {
    if (!moduleDraft) return
    if (!moduleDraft.name.trim()) {
      setMessage('请填写模组名')
      return
    }
    // 跑团状态是必选项：新建时不预选，必须明确选一个
    if (!moduleDraft.playStatus) {
      setMessage('请选择跑团状态')
      return
    }
    const input = {
      name: moduleDraft.name,
      playStatus: moduleDraft.playStatus,
      kps: moduleDraft.kps,
      pairs: moduleDraft.pairs
    }
    await run(
      () =>
        moduleDraft.id ? window.coc.modules.update(moduleDraft.id, input) : window.coc.modules.create(input),
      '模组已保存'
    )
    setModuleDraft(undefined)
  }

  const saveRecord = async (): Promise<void> => {
    if (!recordDraft) return
    if (recordDraft.link) {
      try {
        new URL(recordDraft.link)
      } catch {
        setMessage('请输入包含 http:// 或 https:// 的完整网址')
        return
      }
      const duplicate = await window.coc.records.findDuplicate(
        recordDraft.moduleId,
        recordDraft.link,
        recordDraft.id
      )
      if (duplicate && !window.confirm(`这个链接已用于“${duplicate.name}”。仍然保存吗？`)) return
    }
    const input = {
      name: recordDraft.name || undefined,
      link: recordDraft.link || undefined,
      manualContent: recordDraft.manualContent || undefined,
      playDate: recordDraft.playDate || undefined
    }
    await run(
      () =>
        recordDraft.id
          ? window.coc.records.update(recordDraft.id, {
              ...input,
              dateSource: recordDraft.playDate ? 'manual' : 'none'
            })
          : window.coc.records.create({
              moduleId: recordDraft.moduleId,
              ...(recordDraft.sequenceNo !== undefined ? { sequenceNo: recordDraft.sequenceNo } : {}),
              ...input
            }),
      '场次已保存'
    )
    setRecordDraft(undefined)
  }

  const openRecordEditor = (module: ModuleRecord, sequenceNo?: number): void => {
    setRecordDraft({
      moduleId: module.id,
      name: sequenceNo !== undefined ? `${module.name}第 ${sequenceNo} 场` : '',
      link: '',
      playDate: '',
      manualContent: '',
      ...(sequenceNo !== undefined ? { sequenceNo } : {})
    })
  }

  // 添加场次：编号连续时直接打开编辑器；存在空缺（如删除过场次）时先让用户选择编号
  const requestAddRecord = (module: ModuleRecord): void => {
    const used = snapshot.records
      .filter((record) => record.moduleId === module.id)
      .map((record) => record.sequenceNo)
    const maximum = used.length ? Math.max(...used) : 0
    const usedSet = new Set(used)
    const gaps: number[] = []
    for (let number = 1; number <= maximum; number += 1) {
      if (!usedSet.has(number)) gaps.push(number)
    }
    if (!gaps.length) {
      openRecordEditor(module)
      return
    }
    setSequencePicker({
      moduleId: module.id,
      moduleName: module.name,
      used: [...used].sort((a, b) => a - b),
      gaps,
      next: maximum + 1
    })
  }

  const confirmSequence = (sequenceNo: number): void => {
    const module = snapshot.modules.find((item) => item.id === sequencePicker?.moduleId)
    setSequencePicker(undefined)
    if (module) openRecordEditor(module, sequenceNo)
  }

  // 新建草稿切换所属模组后，原编号选择不再适用，需要清空并重置预填名称
  const onRecordDraftChange = (draft: RecordDraft): void => {
    if (!draft.id && draft.moduleId !== recordDraft?.moduleId) {
      setRecordDraft({ ...draft, sequenceNo: undefined, name: '' })
      return
    }
    setRecordDraft(draft)
  }

  const importTableRows = async (
    rows: TableImportRow[]
  ): Promise<{ modules: number; records: number; updated: number; skipped: number; newModules: string[] }> => {
    const known = new Map(snapshot.modules.map((module) => [module.name.toLowerCase(), module]))
    // 状态是模组级的，表格里却每行都有；先扫一遍，任一行为该模组填了状态就采用，
    // 避免“状态填在第二行、模组却在第一行就建好了”导致漏读。
    const playStatusByModule = new Map<string, ModulePlayStatus>()
    for (const row of rows) {
      const key = row.moduleName.toLowerCase()
      if (row.playStatus && !playStatusByModule.has(key)) playStatusByModule.set(key, row.playStatus)
    }
    const newModules: string[] = []
    let createdModules = 0
    let createdRecords = 0
    let updatedRecords = 0
    let skipped = 0
    for (const row of rows) {
      const key = row.moduleName.toLowerCase()
      let module = known.get(key)
      const incoming = { kps: row.kps, pairs: row.pairs }
      if (!module) {
        // 表格填了就用表格的，没填才落到“未开始”
        module = await window.coc.modules.create({
          name: row.moduleName,
          playStatus: playStatusByModule.get(key) ?? 'not_started',
          kps: incoming.kps,
          pairs: incoming.pairs
        })
        createdModules += 1
        newModules.push(module.name)
        known.set(key, module)
      } else if (incoming.kps.length || incoming.pairs.length) {
        // 已有模组不采信表格里的跑团状态：那是用户自己的判断，
        // 不该被一张可能过期的表格覆盖（与链接状态同样的取舍）。
        const merged = mergeImportedParticipants({ kps: module.kps, pairs: module.pairs }, incoming)
        module = await window.coc.modules.update(module.id, merged)
        known.set(key, module)
      }
      const duplicate = await window.coc.records.findDuplicate(module.id, row.link)
      if (duplicate) {
        // 导出表再导入：用表内信息覆盖更新已存在场次。
        // 0.6.2 起导入不再采信表格里的历史状态，链接一律回到“待检测”，
        // 并清空已抓取的正文与抓取时间，强制重新检测后才能拿到正文。
        await window.coc.records.update(duplicate.id, {
          name: row.sessionName,
          ...(row.playDate ? { playDate: row.playDate, dateSource: 'manual' as const } : {})
        })
        await window.coc.records.resetProbe(duplicate.id)
        updatedRecords += 1
        continue
      }
      try {
        await window.coc.records.create({
          moduleId: module.id,
          name: row.sessionName,
          link: row.link,
          ...(row.playDate ? { playDate: row.playDate } : {})
        })
        createdRecords += 1
      } catch {
        skipped += 1
      }
    }
    await refresh()
    return {
      modules: createdModules,
      records: createdRecords,
      updated: updatedRecords,
      skipped,
      newModules
    }
  }
  const createCharacter = async (): Promise<void> => {
    try {
      const character = await window.coc.characters.create({ edition: 7 })
      await refresh()
      setCharacterId(character.id)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法新建角色卡')
    }
  }

  const saveCharacter = async (data: CharacterData): Promise<void> => {
    try {
      await window.coc.characters.update(data.id, data)
      await refresh()
      setCharacterId(undefined)
      setMessage('角色卡已保存')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '角色卡保存失败')
    }
  }

  const requestDeleteCharacter = (character: CharacterData): void => {
    setConfirmOptions({
      title: '删除角色卡',
      text: `删除角色卡“${character.basic.name || '未命名调查员'}”？模组内的 PC 名字会保留。`,
      confirmLabel: '确认删除',
      danger: true,
      onConfirm: async () => {
        await run(() => window.coc.characters.delete(character.id), '角色卡已删除')
        setCharacterId(undefined)
      }
    })
  }

  const header = pageMeta[page]
  const versionLabel = appVersion ? `V${appVersion}` : ''

  return (
    <div className={windowMaximized ? 'window-frame maximized' : 'window-frame'}>
      <main className={windowMaximized ? 'app-shell maximized' : 'app-shell'}>
      <header className="titlebar" onDoubleClick={() => void window.coc.window.toggleMaximize()}>
        <span className="app-name">
          <img className="app-icon" src={appIcon} alt="" />
          COC 跑团记录簿
        </span>
        <WindowControls />
      </header>
      <div className="workspace">
        <nav className="sidebar" aria-label="主导航">

          {(['records', 'characters', 'notes', 'settings'] as const).map((item) => (
            <button
              className={page === item ? 'nav-item active' : 'nav-item'}
              key={item}
              onClick={() => setPage(item)}
            >
              <span className="nav-dot" />
              {{ records: '跑团记录汇总', characters: '调查员角色卡', notes: '跑团闲记', settings: '数据与设置' }[item]}
            </button>
          ))}
          <div className="privacy-note">
            <strong>{versionLabel}</strong>
            <span>数据仅本机保存、无账户</span>
            <span>仅海豹链接相关联网</span>
            <span>应用制作：亦如长风万里沙</span>
          </div>
        </nav>
        <section className="main-panel">
          <header className="module-header">
            <div>
              <h1>{header.title}</h1>
              <p>{header.subtitle(snapshot)}</p>
            </div>
            <div className="header-actions">
              {page === 'records' && (
                <button
                  className="primary"
                  onClick={() => setModuleDraft({ name: '', kps: [''], pairs: [] })}
                >
                  + 新建模组
                </button>
              )}
              {page === 'characters' && (
                <>
                  <button className="primary" onClick={() => void createCharacter()}>
                    + 新建角色卡
                  </button>
                </>
              )}
              {page === 'notes' && (
                <button className="primary" onClick={() => setNoteCreating(true)}>
                  + 新建闲记
                </button>
              )}
            </div>
          </header>
          <div className="content">
            {message && (
              <div className={messageClosing ? 'notice toast-closing' : 'notice'} role="status">
                <span>{message}</span>
                <button aria-label="关闭提示" onClick={() => setMessage(undefined)}>
                  ×
                </button>
              </div>
            )}
            {loading ? (
              <div className="empty-state">正在读取本地数据…</div>
            ) : page === 'records' ? (
              <>
                <div className="toolbar">
                  <button className="secondary" onClick={() => setTableImportOpen(true)}>
                    导入表格
                  </button>
                  <button className="secondary" onClick={() => setExportAction('table')}>
                    导出表格
                  </button>
                  <span className="toolbar-divider" />
                  <button className="secondary" onClick={() => setBatchCheckOpen(true)}>
                    批量检测
                  </button>
                  <button
                    className="secondary"
                    disabled={!selected.size}
                    onClick={() => setExportAction('batch')}
                  >
                    批量下载
                  </button>
                  <button
                    className="secondary"
                    disabled={!selected.size}
                    onClick={() => setExportAction('combine')}
                  >
                    批量合成
                  </button>{' '}
                  <button className="secondary" onClick={() => setFilterOpen(true)}>
                    选项预设
                  </button>
                </div>
                {!snapshot.modules.length ? (
                  <div className="empty-state">
                    <h2>还没有模组</h2>
                    <p>先建立一个模组，再添加 KP、PC / PL 和场次记录。</p>
                    <button
                      className="primary"
                      onClick={() => setModuleDraft({ name: '', kps: [''], pairs: [] })}
                    >
                      新建第一个模组
                    </button>
                  </div>
                ) : (
                  <div className="module-list">
                    {snapshot.modules.map((module, moduleIndex) => {
                      const records = snapshot.records.filter((record) => record.moduleId === module.id)
                      const allSelected =
                        records.length > 0 && records.every((record) => selected.has(record.id))
                      return (
                        <section className="module-card" key={module.id}>
                          <header className="module-row">
                            <button
                              className="collapse-button"
                              aria-label={module.collapsed ? '展开模组' : '折叠模组'}
                              onClick={() =>
                                void run(() =>
                                  window.coc.modules.update(module.id, { collapsed: !module.collapsed })
                                )
                              }
                            >
                              <SolidTriangleIcon className={module.collapsed ? 'collapsed' : ''} />
                            </button>
                            <button
                              className="module-name"
                              onClick={() =>
                                setModuleDraft({
                                  id: module.id,
                                  name: module.name,
                                  playStatus: module.playStatus,
                                  kps: module.kps.length ? module.kps : [''],
                                  pairs: module.pairs
                                })
                              }
                            >
                              {module.name}
                            </button>
                            <button
                              className="icon-button folder-action"
                              title="打开该模组归档文件夹"
                              onClick={() =>
                                void run(() => window.coc.files.openDirectory('module', module.id))
                              }
                            >
                              <FolderIcon />
                            </button>
                            <span className="count-badge">{records.length} 场</span>
                            <span className={`play-status-badge play-status-${module.playStatus}`}>
                              {MODULE_PLAY_STATUS_LABELS[module.playStatus]}
                            </span>
                            <div className="module-actions">
                              <label className="select-all">
                                <input
                                  type="checkbox"
                                  checked={allSelected}
                                  onChange={(event) =>
                                    setSelected((current) => {
                                      const next = new Set(current)
                                      for (const record of records) {
                                        if (event.target.checked) next.add(record.id)
                                        else next.delete(record.id)
                                      }
                                      return next
                                    })
                                  }
                                />
                                全选本模组
                              </label>

                              <button
                                className="text-button"
                                onClick={() => requestAddRecord(module)}
                              >
                                + 添加场次
                              </button>
                              <button
                                className="icon-button"
                                disabled={moduleIndex === 0}
                                aria-label="模组上移"
                                onClick={() => void run(() => window.coc.modules.move(module.id, -1))}
                              >
                                ↑
                              </button>
                              <button
                                className="icon-button"
                                disabled={moduleIndex === snapshot.modules.length - 1}
                                aria-label="模组下移"
                                onClick={() => void run(() => window.coc.modules.move(module.id, 1))}
                              >
                                ↓
                              </button>
                              <button
                                className="text-button danger"
                                onClick={() =>
                                  setConfirmOptions({
                                    title: '删除模组',
                                    text: `删除模组“${module.name}”及其场次？角色卡会保留。`,
                                    confirmLabel: '确认删除',
                                    danger: true,
                                    onConfirm: () =>
                                      run(
                                        () => window.coc.modules.delete(module.id),
                                        '模组已删除'
                                      )
                                  })
                                }
                              >
                                删除
                              </button>
                            </div>
                          </header>
                          {!module.collapsed && (
                            <>
                              <div className="participants">
                                <button
                                  className="icon-button participants-edit"
                                  title="编辑 KP / PC / PL"
                                  aria-label="编辑 KP / PC / PL"
                                  onClick={() =>
                                    setModuleDraft({
                                      id: module.id,
                                      name: module.name,
                                      playStatus: module.playStatus,
                                      kps: module.kps.length ? module.kps : [''],
                                      pairs: module.pairs
                                    })
                                  }
                                >
                                  <PencilIcon />
                                </button>
                                <span>KP：{module.kps.join('、') || '未填写'}</span>
                                <span>
                                  PC / PL：
                                  {module.pairs
                                    .map((pair) => `${pair.pc || '未填写'} / ${pair.pl || '未填写'}`)
                                    .join('；') || '未填写'}
                                </span>
                                <input
                                  className="module-search"
                                  type="search"
                                  aria-label={`在模组“${module.name}”的全部场次正文内搜索`}
                                  placeholder="全模组正文搜索"
                                  value={moduleSearch[module.id] ?? ''}
                                  onChange={(event) =>
                                    setModuleSearch((current) => ({
                                      ...current,
                                      [module.id]: event.target.value
                                    }))
                                  }
                                />
                              </div>
                              {moduleSearchHits(module).length > 0 && (
                                <div className="module-search-results">
                                  <div className="module-search-head">
                                    在“{module.name}”中找到 {moduleSearchHits(module).length} 场匹配
                                    <button
                                      className="text-button"
                                      onClick={() =>
                                        setModuleSearch((current) => ({ ...current, [module.id]: '' }))
                                      }
                                    >
                                      清除
                                    </button>
                                  </div>
                                  <ul>
                                    {moduleSearchHits(module).map((hit) => (
                                      <li key={hit.recordId}>
                                        <button
                                          className="module-search-hit"
                                          onClick={() => setDetailRecordId(hit.recordId)}
                                        >
                                          <span className="module-search-hit-head">
                                            <strong>{hit.recordName}</strong>
                                            <span className="module-search-count">{hit.matches} 处</span>
                                          </span>
                                          <span className="module-search-excerpt">
                                            {hit.excerptLength > 0 ? (
                                              <>
                                                {hit.excerpt.slice(0, hit.excerptStart)}
                                                <mark>
                                                  {hit.excerpt.slice(
                                                    hit.excerptStart,
                                                    hit.excerptStart + hit.excerptLength
                                                  )}
                                                </mark>
                                                {hit.excerpt.slice(
                                                  hit.excerptStart + hit.excerptLength
                                                )}
                                              </>
                                            ) : (
                                              hit.excerpt
                                            )}
                                          </span>
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {records.length ? (
                                <table>
                                  <thead>
                                    <tr>
                                      <th className="check-column">选择</th>
                                      <th>名称</th>
                                      <th>状态</th>
                                      <th>跑团日期</th>
                                      <th>操作</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {records.map((record, recordIndex) => (
                                      <tr key={record.id}>
                                        <td>
                                          <input
                                            aria-label={`选择 ${record.name}`}
                                            type="checkbox"
                                            checked={selected.has(record.id)}
                                            onChange={(event) =>
                                              setSelected((current) => {
                                                const next = new Set(current)
                                                if (event.target.checked) next.add(record.id)
                                                else next.delete(record.id)
                                                return next
                                              })
                                            }
                                          />
                                        </td>
                                        <td>
                                          <button
                                            className="record-name"
                                            onClick={() => setDetailRecordId(record.id)}
                                          >
                                            {record.name}
                                          </button>
                                          {record.link && (
                                            <small className="record-link" title={record.link}>
                                              {record.link}
                                            </small>
                                          )}
                                        </td>
                                        <td>
                                          <span className={`status status-${record.status}`}>
                                            {statusLabel(record.status)}
                                          </span>
                                        </td>
                                        <td>{record.playDate || '日期未知'}</td>
                                        <td>
                                          <div className="row-actions">
                                            <button
                                              className="text-button"
                                              disabled={record.sourceType === 'manual'}
                                              title={
                                                record.sourceType === 'manual'
                                                  ? '手动内容无需检测'
                                                  : '检测并更新缓存'
                                              }
                                              onClick={() =>
                                                void run(
                                                  () => window.coc.records.probe(record.id),
                                                  '检测完成'
                                                )
                                              }
                                            >
                                              检测
                                            </button>
                                            {(
                                              ['raw', 'doc', 'dialogue-doc', 'docx', 'txt', 'pdf'] as const
                                            ).map((format) => (
                                              <button
                                                className="text-button"
                                                key={format}
                                                onClick={() => void exportRecord(record.id, format)}
                                              >
                                                {exportFormatLabel(format)}
                                              </button>
                                            ))}
                                            <button
                                              className="icon-button"
                                              disabled={recordIndex === 0}
                                              aria-label="场次上移"
                                              onClick={() =>
                                                void run(() => window.coc.records.move(record.id, -1))
                                              }
                                            >
                                              ↑
                                            </button>
                                            <button
                                              className="icon-button"
                                              disabled={recordIndex === records.length - 1}
                                              aria-label="场次下移"
                                              onClick={() =>
                                                void run(() => window.coc.records.move(record.id, 1))
                                              }
                                            >
                                              ↓
                                            </button>
                                            <button
                                              className="text-button"
                                              onClick={() =>
                                                setRecordDraft({
                                                  id: record.id,
                                                  moduleId: record.moduleId,
                                                  name: record.name,
                                                  link: record.link || '',
                                                  playDate: record.playDate || '',
                                                  manualContent: record.manualContent || ''
                                                })
                                              }
                                            >
                                              编辑
                                            </button>
                                            <button
                                              className="text-button danger"
                                              onClick={() =>
                                                setConfirmOptions({
                                                  title: '删除场次',
                                                  text: `删除场次“${record.name}”？`,
                                                  confirmLabel: '确认删除',
                                                  danger: true,
                                                  onConfirm: () => {
                                                    setSelected((current) => {
                                                      const next = new Set(current)
                                                      next.delete(record.id)
                                                      return next
                                                    })
                                                    return run(
                                                      () => window.coc.records.delete(record.id),
                                                      '场次已删除'
                                                    )
                                                  }
                                                })
                                              }
                                            >
                                              删除
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                <div className="module-empty">
                                  暂无场次。可以添加海豹链接，或直接粘贴手动记录。
                                </div>
                              )}
                            </>
                          )}
                        </section>
                      )
                    })}
                  </div>
                )}
              </>
            ) : page === 'characters' ? (
              snapshot.characters.length ? (
                <div className="character-grid">
                  {snapshot.characters.map((character) => {
                    const linkedModules = snapshot.modules.filter((item) =>
                      character.moduleIds.includes(item.id)
                    )
                    const topSkills = [...character.skills]
                      .sort((a, b) => skillFinal(b) - skillFinal(a))
                      .slice(0, 3)
                    return (
                      <article className="character-card" key={character.id}>
                        <div className="character-card-head">
                          <span>
                            {linkedModules.map((item) => item.name).join('、') || '未关联模组'}
                          </span>
                          <span className="edition-badge">第{character.edition === 7 ? '七' : '六'}版</span>
                        </div>
                        <button
                          className="character-card-main"
                          onClick={() => setCharacterId(character.id)}
                        >
                          <strong>{character.basic.name || '未命名调查员'}</strong>
                          <span>{character.basic.age || '未关联年龄'} · {character.basic.occupation || '未填写职业'}</span>
                          <span className="attribute-summary">
                            力量 {character.attrs.STR} · 体质 {character.attrs.CON} · 敏捷{' '}
                            {character.attrs.DEX} · 智力 {character.attrs.INT}
                          </span>
                          <span className="character-skills">
                            {topSkills.map((skill) => `${skill.name} ${skillFinal(skill)}`).join(' · ')}
                          </span>
                        </button>
                        <div className="character-card-actions">
                          <button
                            className="text-button danger"
                            onClick={() => requestDeleteCharacter(character)}
                          >
                            删除
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <div className="empty-state">
                  <h2>还没有调查员角色卡</h2>
                  <p>可创建第六版或第七版角色卡，属性换版会自动换算并保留原始快照。</p>
                  <button className="primary" onClick={() => void createCharacter()}>
                    新建第一张角色卡
                  </button>
                </div>
              )
            ) : page === 'notes' ? (
              <NoteBoard
                notes={snapshot.notes}
                modules={snapshot.modules}
                creating={noteCreating}
                onCreatingHandled={() => setNoteCreating(false)}
                onChanged={refresh}
                onNotice={setMessage}
                onStartCreating={() => setNoteCreating(true)}
              />
            ) : (
              <div className="settings-grid">
                <section className="settings-card">
                  <h2>数据概览</h2>
                  <div className="stats">
                    <div>
                      <strong>{snapshot.modules.length}</strong>
                      <span>模组</span>
                    </div>
                    <div>
                      <strong>{snapshot.records.length}</strong>
                      <span>场次</span>
                    </div>
                    <div>
                      <strong>{snapshot.characters.length}</strong>
                      <span>角色卡</span>
                    </div>
                    <div>
                      <strong>{snapshot.notes.length}</strong>
                      <span>闲记</span>
                    </div>
                  </div>
                </section>
                <section className="settings-card">
                  <h2>备份与恢复</h2>
                  <p>可只备份应用数据，也可将应用已登记的归档文件一并保存。恢复前会先显示内容摘要。</p>
                  <div className="header-actions">
                    <button className="primary" onClick={() => setBackupChoiceOpen(true)}>
                      导出备份
                    </button>
                    <button className="secondary" onClick={() => void chooseRestore()}>
                      恢复备份
                    </button>
                  </div>
                </section>
                <section className="settings-card">
                  <h2>界面外观</h2>
                  <p>主题会立即保存，重新启动后保持。</p>
                  <div className="segmented">
                    <button
                      className={snapshot.settings.theme === 'light' ? 'active' : ''}
                      onClick={() => void run(() => window.coc.settings.update({ theme: 'light' }))}
                    >
                      浅色
                    </button>
                    <button
                      className={snapshot.settings.theme === 'dark' ? 'active' : ''}
                      onClick={() => void run(() => window.coc.settings.update({ theme: 'dark' }))}
                    >
                      深色
                    </button>
                  </div>
                </section>
                <section className="settings-card">
                  <h2>下载归档位置</h2>
                  <p className="path-text">{snapshot.settings.archiveDirectory}</p>
                  {archiveStatus && !archiveStatus.ok && (
                    <p className="archive-warning">
                      此目录当前无法写入{archiveStatus.reason ? `（${archiveStatus.reason}）` : ''}
                      ，下载、合成与导出会失败。请点“更改位置”重新选择，或点“恢复默认位置”。
                    </p>
                  )}
                  <p className="muted">新下载和导出的文件会写入此目录；应用只管理已登记文件。</p>
                  <div className="header-actions">
                    <button
                      className="secondary"
                      onClick={() =>
                        void (async () => {
                          const selectedPath = await window.coc.files.chooseArchiveDirectory()
                          if (selectedPath) {
                            await refresh()
                            setMessage(`归档位置已改为：${selectedPath}`)
                          }
                        })()
                      }
                    >
                      更改位置
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        void (async () => {
                          try {
                            const fallback = await window.coc.files.archiveDefault()
                            await refresh()
                            setMessage(`归档位置已恢复为：${fallback}`)
                          } catch (error) {
                            setMessage(error instanceof Error ? error.message : '无法恢复默认位置')
                          }
                        })()
                      }
                    >
                      恢复默认位置
                    </button>
                    <button
                      className="secondary"
                      onClick={() => void run(() => window.coc.files.openDirectory('archive'))}
                    >
                      打开文件夹
                    </button>
                  </div>
                </section>
                <section className="settings-card">
                  <h2>记录缓存</h2>
                  <p>
                    可释放 {cacheInfo.bytes.toLocaleString()} 字节，共 {cacheInfo.files}{' '}
                    个可重新抓取的缓存文件。
                  </p>
                  <button
                    className="secondary"
                    disabled={!cacheInfo.files}
                    onClick={() =>
                      setConfirmOptions({
                        title: '清理记录缓存',
                        text: `清理 ${cacheInfo.files} 个记录缓存文件？不会删除场次、角色卡或归档文件。`,
                        confirmLabel: '确认清理',
                        onConfirm: async () => {
                          try {
                            const removed = await window.coc.backup.clearCache()
                            await refresh()
                            setMessage(
                              `已清理 ${removed.files} 个缓存文件，释放 ${removed.bytes} 字节。`
                            )
                          } catch (error) {
                            setMessage(error instanceof Error ? error.message : '缓存清理失败')
                          }
                        }
                      })
                    }
                  >
                    清理记录缓存
                  </button>
                </section>
                <section className="settings-card danger-card">
                  <h2>清空应用数据</h2>
                  <p>默认保留设置、归档位置和已保存的导入映射。归档文件是否删除由您单独选择。</p>
                  <button className="danger-button" onClick={() => setClearDataOpen(true)}>
                    清空数据
                  </button>
                </section>
              </div>
            )}
          </div>
        </section>
      </div>
      {moduleDraft && (
        <ModuleEditor
          draft={moduleDraft}
          onChange={setModuleDraft}
          onCancel={() => setModuleDraft(undefined)}
          onSave={() => void saveModule()}
        />
      )}
      {recordDraft && (
        <RecordEditor
          draft={recordDraft}
          modules={snapshot.modules}
          onChange={onRecordDraftChange}
          onCancel={() => setRecordDraft(undefined)}
          onSave={() => void saveRecord()}
        />
      )}
      {sequencePicker && (
        <SequencePickerDialog
          moduleName={sequencePicker.moduleName}
          gaps={sequencePicker.gaps}
          next={sequencePicker.next}
          used={sequencePicker.used}
          onClose={() => setSequencePicker(undefined)}
          onConfirm={confirmSequence}
        />
      )}
      {filterOpen && (
        <FilterEditor
          value={snapshot.settings.filterPreset}
          onClose={() => setFilterOpen(false)}
          onSave={(filterPreset) => {
            void run(() => window.coc.settings.update({ filterPreset }), '选项预设已保存')
            setFilterOpen(false)
          }}
        />
      )}
      {detailRecordId &&
        (() => {
          const record = snapshot.records.find((item) => item.id === detailRecordId)
          return record ? (
            <RecordDetail
              record={record}
              preset={snapshot.settings.filterPreset}
              onClose={() => setDetailRecordId(undefined)}
            />
          ) : null
        })()}
      {exportAction && (
        <ExportDialog
          action={exportAction}
          selectedCount={selected.size}
          onClose={() => setExportAction(undefined)}
          onConfirm={(format, scope) => void executeExport(format, scope)}
        />
      )}
      {tableImportOpen && (
        <RecordImportDialog onClose={() => setTableImportOpen(false)} onImport={importTableRows} />
      )}
      {batchCheckOpen && (
        <BatchCheckDialog
          modules={snapshot.modules}
          records={snapshot.records}
          onClose={() => setBatchCheckOpen(false)}
          onRefresh={refresh}
        />
      )}
      {characterId &&
        (() => {
          const character = snapshot.characters.find((item) => item.id === characterId)
          return character ? (
            <CharacterEditor
              character={character}
              modules={snapshot.modules}
              onClose={() => setCharacterId(undefined)}
              onSave={(data) => void saveCharacter(data)}
              onDelete={() => requestDeleteCharacter(character)}
            />
          ) : null
        })()}
      {confirmOptions && (
        <ConfirmDialog options={confirmOptions} onClose={() => setConfirmOptions(undefined)} />
      )}
      {backupChoiceOpen && (
        <BackupChoiceDialog
          onClose={() => setBackupChoiceOpen(false)}
          onSelect={(includeArchives) => void createBackup(includeArchives)}
        />
      )}
      {restorePreview && (
        <RestorePreviewDialog
          preview={restorePreview}
          onClose={() => setRestorePreview(undefined)}
          onConfirm={(options) => {
            void (async () => {
              try {
                await window.coc.backup.restore(restorePreview.token, options)
                await refresh()
                setRestorePreview(undefined)
                setMessage('备份已恢复；在线日志缓存可按需重新检测。')
              } catch (error) {
                setMessage(error instanceof Error ? error.message : '恢复失败')
              }
            })()
          }}
        />
      )}
      {clearDataOpen && (
        <ClearDataDialog
          onClose={() => setClearDataOpen(false)}
          onConfirm={(options) => {
            void (async () => {
              try {
                const deleted = await window.coc.backup.clearData(options)
                await refresh()
                setClearDataOpen(false)
                setMessage(`应用数据已清空；同时删除了 ${deleted} 个已登记归档文件。`)
              } catch (error) {
                setMessage(error instanceof Error ? error.message : '清空数据失败')
              }
            })()
          }}
        />
      )}
      </main>
    </div>
  )
}
