import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useVisibleViewport, viewportRect } from '../../useVisibleViewport'
import type { CharacterData, ModuleRecord, SessionRecord } from '../../../../../src/shared/types'
import { MODULE_PLAY_STATUS_LABELS } from '../../../../../src/shared/types'
import { sessionNameFor } from '../../../../../src/shared/session-number'
import {
  calculateDerived,
  skillFinal,
  convertCharacterEdition,
  createSkill
} from '../../../../../src/shared/coc-rules'
import type { Edit } from '../../../data/edit'
import type { MobileSnapshot } from '../../../data/types'
import { RemoveButton } from '../RemoveButton'
import { CharacterSuggest } from './components/CharacterSuggest'
import { BACKGROUND_LABELS, WEAPON_LABELS } from '../../characterLabels'
import { useItemLayout } from '../../useItemLayout'
import { SystemMessage } from '../SystemMessage'
import { SelectField } from '../SelectField'
import { NameSuggest } from './components/NameSuggest'
import type { Coc7ImportSummary } from '../../../data/coc7-import'

export function Editor(props: {
  initial: Edit
  snapshot: MobileSnapshot
  busy: boolean
  onSave(edit: Edit): Promise<void>
  onClose(): void
  onConfirm(message: string): Promise<boolean>
  toolbarTarget: HTMLElement | null
  importSummary?: Coc7ImportSummary
}) {
  // 在线正文由存储边界保留；草稿及每次输入的脏检查不复制/编码这部分数据。
  const [original] = useState<Edit>(() => {
    const initial =
      props.initial.kind === 'record'
        ? { ...props.initial, value: { ...props.initial.value, rawContent: undefined } }
        : props.initial
    return JSON.parse(JSON.stringify(initial))
  })
  const [draft, setDraft] = useState<Edit>(original)
  const [error, setError] = useState('')
  const [importIssues, setImportIssues] = useState(props.importSummary?.issues ?? [])
  const [importReminder, setImportReminder] = useState(0)
  /** @param key - 稳定的导入字段键。 @param value - 用户输入，0也视为有效。 @param numeric - 是否要求有限数字。 @returns 无返回值；有效填写后解除标红，不改其他问题字段。 */
  function resolveImportIssue(key: string, value: string, numeric = false) {
    if (value.trim() && (!numeric || Number.isFinite(Number(value))))
      setImportIssues((current) => current.filter((issue) => issue.key !== key))
  }
  const [nameSuggestionRequest, setNameSuggestionRequest] = useState(0)
  const itemLayout = useItemLayout()
  const dirty = JSON.stringify(draft) !== JSON.stringify(original)
  const title = props.importSummary
    ? '导入七版角色卡预览'
    : draft.kind === 'module'
      ? '编辑模组'
      : draft.kind === 'record'
        ? '编辑场次'
        : '编辑角色卡'
  const heading = useRef<HTMLHeadingElement>(null)
  const formId = useId()
  const viewport = useVisibleViewport()
  const editor = useRef<HTMLElement>(null)
  const errorView = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!error) return
    const frame = requestAnimationFrame(() => {
      const box = errorView.current?.getBoundingClientRect()
      if (!box) return
      const view = viewportRect()
      const header = document.querySelector('.app-header')?.getBoundingClientRect()
      window.scrollBy(0, box.top - Math.max(view.top + view.safeTop + 8, (header?.bottom ?? 0) + 8))
    })
    return () => cancelAnimationFrame(frame)
  }, [error])
  useEffect(() => {
    let frame = 0
    const reveal = (event?: Event) => {
      cancelAnimationFrame(frame)
      const requested = event instanceof CustomEvent ? event.detail : undefined
      frame = requestAnimationFrame(() => {
        const active = requested instanceof HTMLInputElement ? requested : document.activeElement
        if (
          !(active instanceof HTMLElement) ||
          !active.matches('input, textarea, select') ||
          !editor.current?.contains(active)
        )
          return
        const view = viewportRect()
        const header = document.querySelector('.app-header')?.getBoundingClientRect()
        const dock = document.querySelector('.navigation-dock')?.getBoundingClientRect()
        const top = Math.max(view.top + view.safeTop + 8, (header?.bottom ?? 0) + 8)
        const bottom = Math.min(view.top + view.height - 8, (dock?.top ?? view.top + view.height) - 8)
        if (bottom <= top) return
        const box = active.getBoundingClientRect()
        const menu = document.getElementById(active.getAttribute('aria-controls') ?? '')
        if (menu?.classList.contains('inline-name-options'))
          menu.style.maxHeight = `${Math.max(44, Math.min(220, bottom - top - box.height - 4))}px`
        const menuBottom = menu?.classList.contains('inline-name-options')
          ? menu.getBoundingClientRect().bottom
          : box.bottom
        if (box.top < top) window.scrollBy(0, box.top - top)
        else if (menuBottom > bottom) window.scrollBy(0, Math.min(menuBottom - bottom, box.top - top))
      })
    }
    editor.current?.addEventListener('focusin', reveal)
    window.addEventListener('resize', reveal)
    window.visualViewport?.addEventListener('resize', reveal)
    window.addEventListener('logbook-name-options-open', reveal)
    reveal()
    const root = editor.current
    return () => {
      cancelAnimationFrame(frame)
      root?.removeEventListener('focusin', reveal)
      window.removeEventListener('resize', reveal)
      window.visualViewport?.removeEventListener('resize', reveal)
      window.removeEventListener('logbook-name-options-open', reveal)
    }
    // 键盘尺寸变化后等待操作栏提交；纯视口平移不再次抢回滚动。
  }, [viewport.height, viewport.width])
  useEffect(() => {
    heading.current?.focus()
  }, [])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || props.busy) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, props.busy])
  /** @returns 无返回值；取消或系统返回经应用弹窗确认后才丢弃草稿。 */
  async function cancel() {
    if (!props.busy && (!dirty || (await props.onConfirm('放弃尚未保存的修改？')))) props.onClose()
  }
  useEffect(() => {
    window.addEventListener('logbook-editor-back', cancel)
    return () => window.removeEventListener('logbook-editor-back', cancel)
  })
  /**
   * 渲染受控输入；提示只显示在空框中，不写入草稿。
   * @param label - 可见且可访问的字段名称。
   * @param value - 草稿值，非有限数字显示为空。
   * @param change - 接收用户输入文本的草稿更新回调。
   * @param type - HTML 输入类型，默认文本。
   * @param placeholder - 空值时的灰字提示，不替代字段标签。
   * @param importKey - 导入问题字段键，默认使用标签；只影响草稿提示。
   * @returns 带标签的输入框。
   */
  function field(
    label: string,
    value: string | number,
    change: (value: string) => void,
    type = 'text',
    placeholder?: string,
    importKey = label
  ) {
    const issue = importIssues.find((issue) => issue.key === importKey)
    return (
      <label className="field" key={label}>
        {label}
        <input
          required={type === 'number' || !!issue}
          aria-label={label}
          aria-invalid={issue ? true : undefined}
          aria-describedby={issue ? `${formId}-issue-${importKey}` : undefined}
          type={type}
          placeholder={placeholder}
          step={type === 'number' ? 'any' : undefined}
          value={issue || (typeof value === 'number' && !Number.isFinite(value)) ? '' : value}
          onChange={(e) => {
            resolveImportIssue(importKey, e.target.value, type === 'number')
            change(e.target.value)
          }}
        />
        {issue && (
          <small className="import-field-error" id={`${formId}-issue-${importKey}`}>
            {issue.message}
          </small>
        )}
      </label>
    )
  }
  function text(label: string, value: string, change: (value: string) => void) {
    return (
      <label className="field" key={label}>
        {label}
        <textarea rows={3} value={value} onChange={(e) => change(e.target.value)} />
      </label>
    )
  }
  function module(value: ModuleRecord) {
    setDraft({ kind: 'module', value })
  }
  function record(value: SessionRecord) {
    setDraft({ kind: 'record', value })
  }
  function character(value: CharacterData) {
    setDraft({ kind: 'character', value })
  }
  const c = draft.kind === 'character' ? draft.value : undefined
  const pcNames = useMemo(
    () => [
      ...new Set(
        props.snapshot.modules
          .filter((module) => c?.moduleIds.includes(module.id))
          .flatMap((module) => module.pairs.map((pair) => pair.pc.trim()).filter(Boolean))
      )
    ],
    [props.snapshot.modules, c?.moduleIds]
  )
  const limits = c ? calculateDerived(c.edition, c.attrs, c.derived.luck7) : undefined
  const activeImportIssues = importIssues.filter(
    (issue) => !issue.key.startsWith('skill:') || c?.skills.some((skill) => issue.key === 'skill:' + skill.id)
  )
  const actions = (
    <>
      {!!activeImportIssues.length && (
        <div className="operation-feedback">
          <SystemMessage
            key={importReminder}
            kind="warning"
            ariaLabel="导入待补填提醒"
            message={`角色卡已读取，有${activeImportIssues.length}项待补填：${activeImportIssues.map((issue) => issue.label).join('、')}。请填写红色标记处后保存。`}
          />
        </div>
      )}
      <div className="dialog-actions editor-actions">
        <button type="button" disabled={props.busy} onClick={cancel}>
          取消编辑
        </button>
        <button type="submit" form={formId} disabled={props.busy} className="primary">
          {props.busy ? '正在保存…' : '保存修改'}
        </button>
      </div>
    </>
  )
  return (
    <section className="panel editor" ref={editor}>
      <h2 ref={heading} tabIndex={-1}>
        {title}
      </h2>
      <p className="muted">保存后更新本机数据；取消不会改变已保存数据。</p>
      {props.importSummary && c && (
        <section className="notice" aria-label="七版角色卡导入说明">
          <p>
            已读取“人物卡”：{c.skills.length}项技能、{c.items.length}项物品。请核对下方内容后保存。
          </p>
          <p>
            仅保留普通成功率≥15的技能，已跳过{props.importSummary.skippedSkills}
            项。职业点数、资产、法术、状态和部位未导入，内置徒手行已跳过。
          </p>
          {props.importSummary.warnings.map((message, i) => (
            <SystemMessage kind="warning" message={message} key={i} />
          ))}
        </section>
      )}
      {error && (
        <div ref={errorView}>
          <SystemMessage kind="error" message={error} onDismiss={() => setError('')} />
        </div>
      )}
      <form
        id={formId}
        onInvalid={() => {
          if (activeImportIssues.length) setImportReminder((value) => value + 1)
        }}
        onSubmit={(event) => {
          event.preventDefault()
          if (props.busy) return
          if (activeImportIssues.length) {
            setImportReminder((value) => value + 1)
            return
          }
          setError('')
          void props
            .onSave(draft)
            .catch((e) => setError(e instanceof Error ? e.message : '保存失败，请重试。'))
        }}
      >
        <fieldset disabled={props.busy}>
          {draft.kind === 'module' && (
            <>
              {field('模组名称', draft.value.name, (name) => module({ ...draft.value, name }))}
              <SelectField
                label="进度"
                disabled={props.busy}
                value={draft.value.playStatus}
                onChange={(value) =>
                  module({
                    ...draft.value,
                    playStatus: value as ModuleRecord['playStatus']
                  })
                }
                options={Object.entries(MODULE_PLAY_STATUS_LABELS).map(([value, label]) => ({
                  value,
                  label
                }))}
              />
              <h3>KP（守密人）</h3>
              <div className="participant-grid">
                {draft.value.kps.map((kp, index) => (
                  <div className="kp-edit-row" key={index}>
                    <span className="badge">KP</span>
                    <label className="field">
                      <span className="sr-only">KP{index + 1}</span>
                      <input
                        value={kp}
                        placeholder="守密人名称"
                        onChange={(event) =>
                          module({
                            ...draft.value,
                            kps: draft.value.kps.map((value, i) => (i === index ? event.target.value : value))
                          })
                        }
                      />
                    </label>
                    <RemoveButton
                      label={'删除 KP' + (index + 1)}
                      onClick={() =>
                        module({
                          ...draft.value,
                          kps: draft.value.kps.filter((_, i) => i !== index)
                        })
                      }
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="inline-add"
                onClick={() => module({ ...draft.value, kps: [...draft.value.kps, ''] })}
              >
                ＋ 添加 KP
              </button>
              <h3>PC / PL 成对名单</h3>
              {draft.value.pairs.map((pair, index) => (
                <div className="pair-row" key={index}>
                  <CharacterSuggest
                    label={'PC' + (index + 1)}
                    value={pair.pc}
                    characterId={pair.characterId}
                    characters={props.snapshot.characters}
                    onChange={(pc, characterId) =>
                      module({
                        ...draft.value,
                        pairs: draft.value.pairs.map((p, i) => (i === index ? { ...p, pc, characterId } : p))
                      })
                    }
                  />
                  {field('PL' + (index + 1), pair.pl, (pl) =>
                    module({
                      ...draft.value,
                      pairs: draft.value.pairs.map((p, i) => (i === index ? { ...p, pl } : p))
                    })
                  )}
                  <RemoveButton
                    label={'删除 PC' + (index + 1) + ' / PL' + (index + 1)}
                    onClick={() =>
                      module({
                        ...draft.value,
                        pairs: draft.value.pairs.filter((_, i) => i !== index)
                      })
                    }
                  />
                </div>
              ))}
              <button
                type="button"
                className="inline-add"
                onClick={() => module({ ...draft.value, pairs: [...draft.value.pairs, { pc: '', pl: '' }] })}
              >
                ＋ 添加参与者
              </button>
            </>
          )}
          {draft.kind === 'record' && (
            <>
              {field(
                '场次名称',
                draft.value.name,
                (name) => record({ ...draft.value, name }),
                'text',
                Number.isInteger(draft.value.sequenceNo) && draft.value.sequenceNo >= 0
                  ? `留空自动命名为“${sessionNameFor('', draft.value.sequenceNo)}”`
                  : '留空按场次序号自动命名'
              )}
              <SelectField
                label="所属模组"
                disabled={props.busy}
                value={draft.value.moduleId}
                onChange={(moduleId) => record({ ...draft.value, moduleId })}
                options={[
                  { value: '', label: '请选择模组' },
                  ...props.snapshot.modules.map((m) => ({ value: m.id, label: m.name }))
                ]}
              />
              {field(
                '场次序号',
                draft.value.sequenceNo,
                (value) =>
                  record({
                    ...draft.value,
                    sequenceNo: value === '' ? NaN : Number(value)
                  }),
                'number'
              )}
              {field(
                '跑团日期',
                draft.value.playDate ?? '',
                (playDate) =>
                  record({
                    ...draft.value,
                    playDate,
                    dateSource: playDate ? 'manual' : 'none'
                  }),
                'date'
              )}
              <SelectField
                label="正文来源"
                disabled={props.busy}
                value={draft.value.sourceType}
                onChange={async (value) => {
                  if (await props.onConfirm('更换来源后，保存时会清除旧来源正文。继续？'))
                    record({ ...draft.value, sourceType: value as 'manual' | 'online' })
                }}
                options={[
                  { value: 'manual', label: '手动正文' },
                  { value: 'online', label: '海豹日志链接' }
                ]}
              />
              {draft.value.sourceType === 'manual'
                ? text('手动正文', draft.value.manualContent ?? '', (manualContent) =>
                    record({ ...draft.value, manualContent })
                  )
                : field('海豹日志链接', draft.value.link ?? '', (link) => record({ ...draft.value, link }))}
            </>
          )}
          {c && (
            <>
              <SelectField
                label="角色规则版次"
                disabled={props.busy}
                value={String(c.edition)}
                onChange={async (value) => {
                  if (
                    await props.onConfirm(
                      '按已有规则转换属性及派生值，保留手填伤害加值和另一版属性快照。继续？'
                    )
                  ) {
                    const converted = convertCharacterEdition(c, Number(value) as 6 | 7)
                    character({
                      ...converted,
                      occupationFormula: c.occupationFormula,
                      derived: { ...converted.derived, db: c.derived.db }
                    })
                  }
                }}
                options={[
                  { value: '6', label: '第六版' },
                  { value: '7', label: '第七版' }
                ]}
              />
              <h3>模组归属</h3>
              {props.snapshot.modules.map((m) => (
                <label className="check" key={m.id}>
                  <input
                    type="checkbox"
                    checked={c.moduleIds.includes(m.id)}
                    onChange={(e) => {
                      const moduleIds = e.target.checked
                        ? [...c.moduleIds, m.id]
                        : c.moduleIds.filter((id) => id !== m.id)
                      character({ ...c, moduleIds, moduleId: moduleIds[0] })
                      if (e.target.checked) setNameSuggestionRequest((request) => request + 1)
                    }}
                  />
                  {m.name}
                </label>
              ))}
              <p className="muted">关联模组仅用于角色归属，不会新增或修改该模组的 PC/PL。</p>
              <div className="edit-grid basic-fields">
                {Object.entries({
                  name: '姓名',
                  occupation: '职业',
                  age: '年龄',
                  gender: '性别',
                  residence: '居住地',
                  birthplace: '故乡'
                }).map(([key, label]) =>
                  key === 'name' ? (
                    <NameSuggest
                      key={key}
                      value={c.basic.name}
                      names={pcNames}
                      requestOpen={nameSuggestionRequest}
                      invalid={importIssues.some((issue) => issue.key === '姓名')}
                      onChange={(name) => {
                        resolveImportIssue('姓名', name)
                        character({ ...c, basic: { ...c.basic, name } })
                      }}
                    />
                  ) : (
                    field(label, c.basic[key as keyof typeof c.basic], (value) =>
                      character({ ...c, basic: { ...c.basic, [key]: value } })
                    )
                  )
                )}
              </div>
              <h3>属性</h3>
              <div className="edit-grid attribute-edit-grid">
                {Object.entries(c.attrs).map(([key, value]) =>
                  field(
                    key,
                    value,
                    (value) => {
                      const attrs = {
                        ...c.attrs,
                        [key]: value === '' ? NaN : Number(value)
                      }
                      character({
                        ...c,
                        attrs,
                        editionSnapshots: {
                          ...c.editionSnapshots,
                          [c.edition]: { ...attrs }
                        },
                        derived: {
                          ...c.derived,
                          luck6: attrs.POW * 5
                        }
                      })
                    },
                    'number'
                  )
                )}
              </div>
              <p className="muted">
                规则参考：HP {limits?.hp} · MP {limits?.mp} · SAN {limits?.san} · 伤害加值 {limits?.db}
                。当前值由你填写。
              </p>
              <div className="edit-grid">
                {(
                  ['hpCurrent', 'mpCurrent', 'sanCurrent', ...(c.edition === 7 ? ['luck7'] : [])] as const
                ).map((key) =>
                  field(
                    (
                      {
                        hpCurrent: '当前 HP',
                        mpCurrent: '当前 MP',
                        sanCurrent: '当前 SAN',
                        luck7: '幸运'
                      } as Record<string, string>
                    )[key]!,
                    c.derived[key as keyof typeof c.derived] ?? 0,
                    (value) =>
                      character({
                        ...c,
                        derived: {
                          ...c.derived,
                          [key]: value === '' ? NaN : Number(value)
                        }
                      }),
                    'number'
                  )
                )}
              </div>
              {field('伤害加值', c.derived.db, (db) => character({ ...c, derived: { ...c.derived, db } }))}
              <details open={importIssues.some((issue) => issue.key.startsWith('skill:')) || undefined}>
                <summary>技能</summary>
                <button
                  type="button"
                  className="inline-add"
                  onClick={() =>
                    character({
                      ...c,
                      skills: [...c.skills, createSkill('新技能')]
                    })
                  }
                >
                  ＋ 添加技能
                </button>
                <div className="skill-editor-grid">
                  {c.skills.map((skill, index) => (
                    <div key={skill.id} className="skill-edit-row">
                      <input
                        aria-label={'技能' + (index + 1) + '名称'}
                        value={skill.name}
                        onChange={(event) =>
                          character({
                            ...c,
                            skills: c.skills.map((s, i) =>
                              i === index ? { ...s, name: event.target.value } : s
                            )
                          })
                        }
                      />
                      <input
                        aria-label={'技能' + (index + 1) + '数值'}
                        aria-invalid={
                          importIssues.some((issue) => issue.key === 'skill:' + skill.id) || undefined
                        }
                        title={importIssues.find((issue) => issue.key === 'skill:' + skill.id)?.message}
                        type="number"
                        required
                        step="any"
                        value={
                          !importIssues.some((issue) => issue.key === 'skill:' + skill.id) &&
                          Number.isFinite(skillFinal(skill))
                            ? skillFinal(skill)
                            : ''
                        }
                        onChange={(event) => {
                          resolveImportIssue('skill:' + skill.id, event.target.value, true)
                          character({
                            ...c,
                            skills: c.skills.map((s, i) =>
                              i === index
                                ? {
                                    ...s,
                                    base: event.target.value === '' ? NaN : Number(event.target.value),
                                    occupation: 0,
                                    interest: 0,
                                    growth: 0
                                  }
                                : s
                            )
                          })
                        }}
                      />
                      <RemoveButton
                        label={'删除技能' + (index + 1)}
                        onClick={() =>
                          character({
                            ...c,
                            skills: c.skills.filter((_, i) => i !== index)
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </details>
              <details>
                <summary>武器战斗表</summary>
                {c.weapons.map((weapon, index) => (
                  <section key={index} className="pair-editor">
                    <div className="edit-grid">
                      {Object.entries(WEAPON_LABELS).map(([key, label]) =>
                        field('武器' + (index + 1) + label, String(weapon[key] ?? ''), (value) =>
                          character({
                            ...c,
                            weapons: c.weapons.map((w, i) => (i === index ? { ...w, [key]: value } : w))
                          })
                        )
                      )}
                    </div>
                    <RemoveButton
                      label={'删除武器' + (index + 1)}
                      onClick={() => character({ ...c, weapons: c.weapons.filter((_, i) => i !== index) })}
                    />
                  </section>
                ))}
                <button
                  type="button"
                  className="inline-add"
                  onClick={() => character({ ...c, weapons: [...c.weapons, {}] })}
                >
                  添加武器
                </button>
              </details>
              <div className="section-heading-with-action">
                <h3>财产与装备</h3>
                <button
                  type="button"
                  className="inline-add"
                  onClick={() => character({ ...c, items: [...c.items, ''] })}
                >
                  ＋ 添加物品
                </button>
              </div>
              <div className="item-editor-grid" ref={itemLayout.ref} style={itemLayout.gridStyle}>
                {c.items.map((item, index) => (
                  <div className="item-edit-row" key={index} style={itemLayout.itemStyle(item)}>
                    <input
                      aria-label={'物品' + (index + 1)}
                      value={item}
                      onChange={(event) =>
                        character({
                          ...c,
                          items: c.items.map((value, i) => (i === index ? event.target.value : value))
                        })
                      }
                    />
                    <RemoveButton
                      label={'删除物品' + (index + 1)}
                      onClick={() =>
                        character({
                          ...c,
                          items: c.items.filter((_, i) => i !== index)
                        })
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="background-fields">
                {Object.entries({
                  description: '',
                  belief: '',
                  importantPerson: '',
                  significantPlace: '',
                  treasure: '',
                  trait: '',
                  secret: '',
                  wound: '',
                  phobia: '',
                  ...c.background
                }).map(([key, value]) =>
                  text(BACKGROUND_LABELS[key] ?? key, value, (value) =>
                    character({
                      ...c,
                      background: { ...c.background, [key]: value }
                    })
                  )
                )}
                {text('调查员经历', c.story, (story) => character({ ...c, story }))}
              </div>
            </>
          )}
          {props.toolbarTarget ? createPortal(actions, props.toolbarTarget) : actions}
        </fieldset>
      </form>
    </section>
  )
}
