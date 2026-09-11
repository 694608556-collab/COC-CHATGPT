import { useEffect, useMemo, useState } from 'react'
import { applyLogFilters } from '../../shared/log-filter'
import {
  COC7_FORMULAS,
  calculateDerived,
  convertCharacterEdition,
  skillFinal,
  skillPointSummary
} from '../../shared/coc-rules'
import type { CharacterField } from '../../shared/character-template'
import type { BackupPreviewApi, CharacterImportPreviewApi } from '../../shared/api'
import {
  DEFAULT_FILTER_PRESET,
  type AppSnapshot,
  type CharacterData,
  type FilterPreset,
  type ModuleRecord,
  type ParticipantPair,
  type SessionRecord
} from '../../shared/types'

type Page = 'records' | 'characters' | 'settings'

const pageMeta: Record<Page, { title: string; subtitle: (snapshot: AppSnapshot) => string }> = {
  records: {
    title: '跑团记录汇总',
    subtitle: (snapshot) => `模组 ${snapshot.modules.length} · 场次 ${snapshot.records.length}`
  },
  characters: { title: '调查员角色卡', subtitle: (snapshot) => `角色 ${snapshot.characters.length}` },
  settings: { title: '数据与设置', subtitle: () => '全部数据仅保存在本机' }
}

interface ModuleDraft {
  id?: string
  name: string
  kps: string
  pairs: ParticipantPair[]
}

interface RecordDraft {
  id?: string
  moduleId: string
  name: string
  link: string
  playDate: string
  manualContent: string
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

const importFields: Array<[CharacterField, string]> = [
  ['basic.name', '姓名'],
  ['basic.occupation', '职业'],
  ['basic.age', '年龄'],
  ['basic.gender', '性别'],
  ['basic.birthplace', '出生地'],
  ['basic.residence', '居住地'],
  ['attrs.STR', 'STR'],
  ['attrs.CON', 'CON'],
  ['attrs.SIZ', 'SIZ'],
  ['attrs.DEX', 'DEX'],
  ['attrs.APP', 'APP'],
  ['attrs.INT', 'INT'],
  ['attrs.POW', 'POW'],
  ['attrs.EDU', 'EDU'],
  ['derived.luck7', '幸运'],
  ['story', '调查员经历']
]

function CharacterImportDialog({
  preview,
  modules,
  onClose,
  onConfirm
}: {
  preview: CharacterImportPreviewApi
  modules: ModuleRecord[]
  onClose(): void
  onConfirm(selections: Parameters<Window['coc']['files']['commitCharacterImport']>[1]): void
}): React.JSX.Element {
  const [rows, setRows] = useState(() =>
    preview.sheets.map((sheet) => ({
      selected: true,
      sheetName: sheet.sheetName,
      edition: sheet.edition,
      moduleId: '',
      mapping: { ...sheet.mapping },
      skillHeaderRow: sheet.skillHeaderRow,
      mappingName: ''
    }))
  )
  return (
    <Modal title={`导入角色卡 · ${preview.fileName}`} onClose={onClose}>
      <div className="import-preview-list">
        {preview.sheets.map((sheet, index) => {
          const row = rows[index]!
          return (
            <section className="import-sheet" key={sheet.sheetName}>
              <div className="section-heading">
                <label className="radio-row">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={(event) =>
                      setRows(
                        rows.map((item, i) =>
                          i === index ? { ...item, selected: event.target.checked } : item
                        )
                      )
                    }
                  />
                  <strong>{sheet.sheetName}</strong>
                </label>
                <span className={sheet.confidence < 0.6 ? 'warning-text' : ''}>
                  识别置信度 {Math.round(sheet.confidence * 100)}%
                </span>
              </div>
              {sheet.warnings.map((warning) => (
                <p className="warning-text" key={warning}>
                  {warning}
                </p>
              ))}
              <div className="form-grid two-columns">
                <label>
                  规则版本
                  <select
                    value={row.edition}
                    onChange={(event) =>
                      setRows(
                        rows.map((item, i) =>
                          i === index ? { ...item, edition: Number(event.target.value) as 6 | 7 } : item
                        )
                      )
                    }
                  >
                    <option value={7}>第七版</option>
                    <option value={6}>第六版</option>
                  </select>
                </label>
                <label>
                  关联模组
                  <select
                    value={row.moduleId}
                    onChange={(event) =>
                      setRows(
                        rows.map((item, i) =>
                          i === index ? { ...item, moduleId: event.target.value } : item
                        )
                      )
                    }
                  >
                    <option value="">暂不关联</option>
                    {modules.map((module) => (
                      <option key={module.id} value={module.id}>
                        {module.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <details open={sheet.confidence < 0.6}>
                <summary>检查或手动调整字段映射</summary>
                <div className="mapping-grid">
                  {importFields.map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <select
                        value={row.mapping[field] ?? ''}
                        onChange={(event) =>
                          setRows(
                            rows.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    mapping: { ...item.mapping, [field]: event.target.value || undefined }
                                  }
                                : item
                            )
                          )
                        }
                      >
                        <option value="">未映射</option>
                        {sheet.cells.map((cell) => (
                          <option key={cell.address} value={cell.address}>
                            {cell.address} · {String(cell.value).slice(0, 30)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </details>
              <label>
                保存此映射为（选填）
                <input
                  value={row.mappingName}
                  onChange={(event) =>
                    setRows(
                      rows.map((item, i) =>
                        i === index ? { ...item, mappingName: event.target.value } : item
                      )
                    )
                  }
                />
              </label>
            </section>
          )
        })}
      </div>
      <footer className="modal-actions">
        <button className="secondary" onClick={onClose}>
          取消
        </button>
        <button
          className="primary"
          onClick={() =>
            onConfirm(
              rows
                .filter((row) => row.selected)
                .map((row) => ({
                  sheetName: row.sheetName,
                  edition: row.edition,
                  moduleId: row.moduleId || undefined,
                  mapping: row.mapping,
                  skillHeaderRow: row.skillHeaderRow,
                  mappingName: row.mappingName || undefined
                }))
            )
          }
        >
          确认导入
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

function CharacterEditor({
  character,
  modules,
  onClose,
  onSave,
  onDelete
}: {
  character: CharacterData
  modules: ModuleRecord[]
  onClose(): void
  onSave(data: CharacterData, moduleId: string | undefined, policy: 'remove' | 'retain-name' | 'cancel'): void
  onDelete(): void
}): React.JSX.Element {
  const [draft, setDraft] = useState(() => structuredClone(character))
  const [moduleId, setModuleId] = useState(character.moduleId ?? '')
  const [movePolicy, setMovePolicy] = useState<'remove' | 'retain-name' | 'cancel'>('retain-name')
  const points = skillPointSummary(draft)
  const limits = calculateDerived(draft.edition, draft.attrs, draft.derived.luck7 ?? 50)
  const moduleChanged = moduleId !== (character.moduleId ?? '')
  const updateBasic = (field: keyof CharacterData['basic'], value: string): void =>
    setDraft({ ...draft, basic: { ...draft.basic, [field]: value } })
  const updateAttribute = (field: keyof CharacterData['attrs'], value: number): void =>
    setDraft({ ...draft, attrs: { ...draft.attrs, [field]: value } })
  return (
    <Modal title={`调查员角色卡 · ${draft.basic.name || '未命名'}`} onClose={onClose}>
      <div className="character-editor">
        <section>
          <h3>基本资料</h3>
          <div className="form-grid two-columns">
            <label>
              姓名
              <input value={draft.basic.name} onChange={(event) => updateBasic('name', event.target.value)} />
            </label>
            <label>
              职业
              <input
                value={draft.basic.occupation}
                onChange={(event) => updateBasic('occupation', event.target.value)}
              />
            </label>
            <label>
              规则版本
              <select
                value={draft.edition}
                onChange={(event) =>
                  setDraft(convertCharacterEdition(draft, Number(event.target.value) as 6 | 7))
                }
              >
                <option value={7}>第七版</option>
                <option value={6}>第六版</option>
              </select>
            </label>
            <label>
              所属模组
              <select value={moduleId} onChange={(event) => setModuleId(event.target.value)}>
                <option value="">未归属模组</option>
                {modules.map((module) => (
                  <option key={module.id} value={module.id}>
                    {module.name}
                  </option>
                ))}
              </select>
            </label>
            {(['age', 'gender', 'birthplace', 'residence'] as const).map((field) => (
              <label key={field}>
                {{ age: '年龄', gender: '性别', birthplace: '出生地', residence: '居住地' }[field]}
                <input
                  value={draft.basic[field]}
                  onChange={(event) => updateBasic(field, event.target.value)}
                />
              </label>
            ))}
          </div>
          {moduleChanged && (
            <label>
              原模组的 PC 名单
              <select
                value={movePolicy}
                onChange={(event) => setMovePolicy(event.target.value as typeof movePolicy)}
              >
                <option value="retain-name">保留名字，但解除角色卡关联</option>
                <option value="remove">删除原模组中的 PC 行</option>
                <option value="cancel">只保存资料，不移动角色卡</option>
              </select>
            </label>
          )}
        </section>
        <section>
          <h3>属性与当前状态</h3>
          <div className="attribute-grid">
            {(Object.keys(draft.attrs) as Array<keyof CharacterData['attrs']>).map((field) => (
              <label key={field}>
                {field}
                <input
                  type="number"
                  min={0}
                  value={draft.attrs[field]}
                  onChange={(event) => updateAttribute(field, Number(event.target.value))}
                />
              </label>
            ))}
          </div>
          <div className="derived-strip">
            <label>
              HP（上限 {limits.hp}）
              <input
                type="number"
                value={draft.derived.hpCurrent}
                onChange={(event) =>
                  setDraft({ ...draft, derived: { ...draft.derived, hpCurrent: Number(event.target.value) } })
                }
              />
            </label>
            <label>
              MP（上限 {limits.mp}）
              <input
                type="number"
                value={draft.derived.mpCurrent}
                onChange={(event) =>
                  setDraft({ ...draft, derived: { ...draft.derived, mpCurrent: Number(event.target.value) } })
                }
              />
            </label>
            <label>
              SAN（上限 {limits.san}）
              <input
                type="number"
                value={draft.derived.sanCurrent}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    derived: { ...draft.derived, sanCurrent: Number(event.target.value) }
                  })
                }
              />
            </label>
            <label>
              幸运
              <input
                type="number"
                value={draft.edition === 6 ? draft.attrs.POW * 5 : (draft.derived.luck7 ?? 50)}
                disabled={draft.edition === 6}
                onChange={(event) =>
                  setDraft({ ...draft, derived: { ...draft.derived, luck7: Number(event.target.value) } })
                }
              />
            </label>
            <span>伤害加值：{limits.db}</span>
          </div>
        </section>
        <section>
          <div className="section-heading">
            <h3>技能</h3>
            <div className="point-summary">
              <span className={points.occupationUsed > points.occupationLimit ? 'warning-text' : ''}>
                职业 {points.occupationUsed}/{points.occupationLimit}
              </span>
              <span className={points.interestUsed > points.interestLimit ? 'warning-text' : ''}>
                兴趣 {points.interestUsed}/{points.interestLimit}
              </span>
            </div>
          </div>
          <div className="form-grid two-columns">
            {draft.edition === 7 && (
              <label>
                职业技能点公式
                <select
                  value={draft.occupationFormula}
                  onChange={(event) => setDraft({ ...draft, occupationFormula: event.target.value })}
                >
                  {COC7_FORMULAS.map((formula) => (
                    <option key={formula}>{formula}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              手动职业技能点上限（留空使用公式）
              <input
                type="number"
                value={draft.occupationPointOverride ?? ''}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    occupationPointOverride: event.target.value ? Number(event.target.value) : undefined
                  })
                }
              />
            </label>
          </div>
          <div className="skill-table-wrap">
            <table className="skill-table">
              <thead>
                <tr>
                  <th>技能</th>
                  <th>基础</th>
                  <th>职业</th>
                  <th>兴趣</th>
                  <th>成长</th>
                  <th>合计</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.skills.map((skill, index) => (
                  <tr key={skill.id}>
                    <td>
                      <input
                        value={skill.name}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            skills: draft.skills.map((item, i) =>
                              i === index ? { ...item, name: event.target.value } : item
                            )
                          })
                        }
                      />
                    </td>
                    {(['base', 'occupation', 'interest', 'growth'] as const).map((field) => (
                      <td key={field}>
                        <input
                          type="number"
                          value={skill[field]}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              skills: draft.skills.map((item, i) =>
                                i === index ? { ...item, [field]: Number(event.target.value) } : item
                              )
                            })
                          }
                        />
                      </td>
                    ))}
                    <td>{skillFinal(skill)}</td>
                    <td>
                      <button
                        className="text-button danger"
                        onClick={() =>
                          setDraft({ ...draft, skills: draft.skills.filter((_, i) => i !== index) })
                        }
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="secondary"
            onClick={() =>
              setDraft({
                ...draft,
                skills: [
                  ...draft.skills,
                  {
                    id: crypto.randomUUID(),
                    name: '自定义技能',
                    base: 0,
                    occupation: 0,
                    interest: 0,
                    growth: 0,
                    builtIn: false,
                    mappingState: 'review'
                  }
                ]
              })
            }
          >
            + 添加自定义技能
          </button>
        </section>
        <section>
          <h3>物品清单与经历</h3>
          <label>
            物品清单（每行一项）
            <textarea
              rows={4}
              value={draft.items.join('\n')}
              onChange={(event) => setDraft({ ...draft, items: event.target.value.split(/\r?\n/) })}
            />
          </label>
          <label>
            调查员经历
            <textarea
              rows={5}
              value={draft.story}
              onChange={(event) => setDraft({ ...draft, story: event.target.value })}
            />
          </label>
        </section>
      </div>
      <footer className="modal-actions">
        <button className="text-button danger" onClick={onDelete}>
          删除角色卡
        </button>
        <span className="spacer" />
        <button className="secondary" onClick={onClose}>
          取消
        </button>
        <button className="primary" onClick={() => onSave(draft, moduleId || undefined, movePolicy)}>
          保存角色卡
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
        <label>
          模组名
          <input
            autoFocus
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            placeholder="例如：暗影循迹"
          />
        </label>
        <label>
          KP（每行一位）
          <textarea
            rows={3}
            value={draft.kps}
            onChange={(event) => onChange({ ...draft, kps: event.target.value })}
          />
        </label>
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
                className="text-button danger"
                onClick={() =>
                  onChange({ ...draft, pairs: draft.pairs.filter((_, pairIndex) => pairIndex !== index) })
                }
              >
                删除
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
  ['indentFirstLine', '首行缩进对齐'],
  ['darkDisplay', '深色模式展示']
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
          <label key={key}>
            <span>{label}</span>
            <input
              type="checkbox"
              checked={draft[key]}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })}
            />
          </label>
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
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string>()
  const [moduleDraft, setModuleDraft] = useState<ModuleDraft>()
  const [recordDraft, setRecordDraft] = useState<RecordDraft>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filterOpen, setFilterOpen] = useState(false)
  const [detailRecordId, setDetailRecordId] = useState<string>()
  const [exportAction, setExportAction] = useState<ExportAction>()
  const [characterId, setCharacterId] = useState<string>()
  const [characterImport, setCharacterImport] = useState<CharacterImportPreviewApi>()
  const [backupChoiceOpen, setBackupChoiceOpen] = useState(false)
  const [restorePreview, setRestorePreview] = useState<BackupPreviewApi>()
  const [clearDataOpen, setClearDataOpen] = useState(false)
  const [cacheInfo, setCacheInfo] = useState<{ bytes: number; files: number }>({ bytes: 0, files: 0 })

  const refresh = async (): Promise<void> => {
    const value = await window.coc.app.snapshot()
    setSnapshot(value)
    document.documentElement.dataset.theme = value.settings.theme
    setCacheInfo(await window.coc.backup.cacheStats())
    setLoading(false)
  }

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : '无法读取本地数据')
      setLoading(false)
    })
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

  const executeExport = async (
    format: ExportFormat,
    scope: 'all' | 'selected'
  ): Promise<void> => {
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
      } else if (action === 'batch') {
        const job = await window.coc.files.batchExport(ids, format as RecordExportFormat)
        const succeeded = job.results.filter((item) => item.state === 'success').length
        const failed = job.results.filter((item) => item.state === 'failed').length
        setMessage(`批量下载完成：成功 ${succeeded}，失败 ${failed}。`)
      } else {
        const result = await window.coc.files.exportCombined(ids, format as CombinedExportFormat)
        setMessage(
          `合集已保存：${result.entry.path}；包含 ${result.included.length} 场，跳过 ${result.failed.length} 场。`
        )
      }
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出未完成')
    }
  }

  const saveModule = async (): Promise<void> => {
    if (!moduleDraft) return
    const input = { name: moduleDraft.name, kps: moduleDraft.kps.split(/\r?\n/), pairs: moduleDraft.pairs }
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
          : window.coc.records.create({ moduleId: recordDraft.moduleId, ...input }),
      '场次已保存'
    )
    setRecordDraft(undefined)
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

  const chooseCharacterImport = async (): Promise<void> => {
    try {
      const preview = await window.coc.files.chooseCharacterImport()
      if (preview) setCharacterImport(preview)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法读取角色卡表格')
    }
  }

  const exportCharacter = async (id: string, format: 'xlsx' | 'pdf'): Promise<void> => {
    try {
      const entry = await window.coc.files.exportCharacter(id, format)
      await refresh()
      setMessage(`角色卡已保存：${entry.path}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '角色卡导出失败')
    }
  }

  const saveCharacter = async (
    data: CharacterData,
    moduleId: string | undefined,
    policy: 'remove' | 'retain-name' | 'cancel'
  ): Promise<void> => {
    try {
      await window.coc.characters.update(data.id, data)
      if (moduleId !== data.moduleId) await window.coc.characters.move(data.id, moduleId, policy)
      await refresh()
      setCharacterId(undefined)
      setMessage('角色卡已保存')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '角色卡保存失败')
    }
  }

  const selectedModules = useMemo(
    () =>
      new Set(snapshot.records.filter((record) => selected.has(record.id)).map((record) => record.moduleId)),
    [selected, snapshot.records]
  )
  const header = pageMeta[page]

  return (
    <main className="app-shell">
      <header className="titlebar" onDoubleClick={() => void window.coc.window.toggleMaximize()}>
        <span className="app-name">COC 跑团记录簿</span>
        <WindowControls />
      </header>
      <div className="workspace">
        <nav className="sidebar" aria-label="主导航">
          <div className="brand">
            <span className="brand-mark">C</span>
            <div>
              <strong>COC</strong>
              <small>个人记录簿</small>
            </div>
          </div>
          {(['records', 'characters', 'settings'] as const).map((item) => (
            <button
              className={page === item ? 'nav-item active' : 'nav-item'}
              key={item}
              onClick={() => setPage(item)}
            >
              <span className="nav-dot" />
              {{ records: '跑团记录汇总', characters: '调查员角色卡', settings: '数据与设置' }[item]}
            </button>
          ))}
          <div className="privacy-note">
            本机保存
            <br />
            <span>无账号 · 无云同步</span>
          </div>
        </nav>
        <section className="main-panel">
          <header className="module-header">
            <div>
              <h1>{header.title}</h1>
              <p>{header.subtitle(snapshot)}</p>
            </div>
            <div className="header-actions">
              <button
                className="secondary"
                onClick={() =>
                  void run(() =>
                    window.coc.settings.update({
                      theme: snapshot.settings.theme === 'light' ? 'dark' : 'light'
                    })
                  )
                }
              >
                {snapshot.settings.theme === 'light' ? '深色' : '浅色'}
              </button>
              {page === 'records' && (
                <button className="primary" onClick={() => setModuleDraft({ name: '', kps: '', pairs: [] })}>
                  + 新建模组
                </button>
              )}
              {page === 'characters' && (
                <>
                  <button className="secondary" onClick={() => void chooseCharacterImport()}>
                    导入模板
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      void run(
                        () => window.coc.files.saveCharacterTemplate(6),
                        '第六版空白模板已保存到归档目录'
                      )
                    }
                  >
                    第六版空白模板
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      void run(
                        () => window.coc.files.saveCharacterTemplate(7),
                        '第七版通用空白模板已保存到归档目录'
                      )
                    }
                  >
                    第七版空白模板
                  </button>
                  <button className="primary" onClick={() => void createCharacter()}>
                    + 新建角色卡
                  </button>
                </>
              )}
            </div>
          </header>
          <div className="content">
            {message && (
              <div className="notice" role="status">
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
                  <button className="secondary">导入表格</button>
                  <button className="secondary" onClick={() => setExportAction('table')}>
                    导出表格
                  </button>
                  <span className="toolbar-divider" />
                  <button
                    className="secondary"
                    disabled={!selected.size}
                    onClick={() => setExportAction('batch')}
                  >
                    批量下载
                  </button>
                  <button
                    className="secondary"
                    disabled={!selected.size || selectedModules.size > 1}
                    title={selectedModules.size > 1 ? '批量合成只允许同一模组' : ''}
                    onClick={() => setExportAction('combine')}
                  >
                    批量合成
                  </button>
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
                      onClick={() => setModuleDraft({ name: '', kps: '', pairs: [] })}
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
                              {module.collapsed ? '›' : '⌄'}
                            </button>
                            <button
                              className="module-name"
                              onClick={() =>
                                setModuleDraft({
                                  id: module.id,
                                  name: module.name,
                                  kps: module.kps.join('\n'),
                                  pairs: module.pairs
                                })
                              }
                            >
                              {module.name}
                            </button>
                            <span className="count-badge">{records.length} 场</span>
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
                                onClick={() =>
                                  void run(() => window.coc.files.openDirectory('module', module.id))
                                }
                              >
                                文件夹
                              </button>
                              <button
                                className="text-button"
                                onClick={() =>
                                  setRecordDraft({
                                    moduleId: module.id,
                                    name: '',
                                    link: '',
                                    playDate: '',
                                    manualContent: ''
                                  })
                                }
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
                                onClick={() => {
                                  if (window.confirm(`删除模组“${module.name}”及其场次？角色卡会保留。`))
                                    void run(() => window.coc.modules.delete(module.id), '模组已删除')
                                }}
                              >
                                删除
                              </button>
                            </div>
                          </header>
                          {!module.collapsed && (
                            <>
                              <div className="participants">
                                <span>KP：{module.kps.join('、') || '未填写'}</span>
                                <span>
                                  PC / PL：
                                  {module.pairs
                                    .map((pair) => `${pair.pc || '未填写'} / ${pair.pl || '未填写'}`)
                                    .join('；') || '未填写'}
                                </span>
                              </div>
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
                                            {(['raw', 'doc', 'dialogue-doc', 'docx', 'txt', 'pdf'] as const).map(
                                              (format) => (
                                                <button
                                                  className="text-button"
                                                  key={format}
                                                  onClick={() => void exportRecord(record.id, format)}
                                                >
                                                  {exportFormatLabel(format)}
                                                </button>
                                              )
                                            )}
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
                                              onClick={() => {
                                                if (window.confirm(`删除场次“${record.name}”？`)) {
                                                  setSelected((current) => {
                                                    const next = new Set(current)
                                                    next.delete(record.id)
                                                    return next
                                                  })
                                                  void run(
                                                    () => window.coc.records.delete(record.id),
                                                    '场次已删除'
                                                  )
                                                }
                                              }}
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
                    const module = snapshot.modules.find((item) => item.id === character.moduleId)
                    const points = skillPointSummary(character)
                    return (
                      <article className="character-card" key={character.id}>
                        <button className="character-card-main" onClick={() => setCharacterId(character.id)}>
                          <span className="edition-badge">第{character.edition === 7 ? '七' : '六'}版</span>
                          <strong>{character.basic.name || '未命名调查员'}</strong>
                          <span>{character.basic.occupation || '未填写职业'}</span>
                          <span>{module?.name || '未归属模组'}</span>
                          <small>
                            职业技能点 {points.occupationUsed}/{points.occupationLimit} · 兴趣技能点{' '}
                            {points.interestUsed}/{points.interestLimit}
                          </small>
                        </button>
                        <div className="character-card-actions">
                          <button
                            className="text-button"
                            onClick={() => void exportCharacter(character.id, 'xlsx')}
                          >
                            导出 XLSX
                          </button>
                          <button
                            className="text-button"
                            onClick={() => void exportCharacter(character.id, 'pdf')}
                          >
                            导出 PDF
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
                <section className="settings-card wide">
                  <h2>下载归档位置</h2>
                  <p className="path-text">{snapshot.settings.archiveDirectory}</p>
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
                      void (async () => {
                        if (
                          !window.confirm(
                            `清理 ${cacheInfo.files} 个记录缓存文件？不会删除场次、角色卡或归档文件。`
                          )
                        )
                          return
                        try {
                          const removed = await window.coc.backup.clearCache()
                          await refresh()
                          setMessage(`已清理 ${removed.files} 个缓存文件，释放 ${removed.bytes} 字节。`)
                        } catch (error) {
                          setMessage(error instanceof Error ? error.message : '缓存清理失败')
                        }
                      })()
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
          onChange={setRecordDraft}
          onCancel={() => setRecordDraft(undefined)}
          onSave={() => void saveRecord()}
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
      {characterId &&
        (() => {
          const character = snapshot.characters.find((item) => item.id === characterId)
          return character ? (
            <CharacterEditor
              character={character}
              modules={snapshot.modules}
              onClose={() => setCharacterId(undefined)}
              onSave={(data, moduleId, policy) => void saveCharacter(data, moduleId, policy)}
              onDelete={() => {
                if (
                  !window.confirm(
                    `删除角色卡“${character.basic.name || '未命名调查员'}”？模组内的 PC 名字会保留。`
                  )
                )
                  return
                void run(() => window.coc.characters.delete(character.id), '角色卡已删除')
                setCharacterId(undefined)
              }}
            />
          ) : null
        })()}
      {characterImport && (
        <CharacterImportDialog
          preview={characterImport}
          modules={snapshot.modules}
          onClose={() => setCharacterImport(undefined)}
          onConfirm={(selections) => {
            void (async () => {
              try {
                const created = await window.coc.files.commitCharacterImport(
                  characterImport.token,
                  selections
                )
                await refresh()
                setCharacterImport(undefined)
                setMessage(`已导入 ${created.length} 张角色卡`)
              } catch (error) {
                setMessage(error instanceof Error ? error.message : '角色卡导入失败')
              }
            })()
          }}
        />
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
  )
}
