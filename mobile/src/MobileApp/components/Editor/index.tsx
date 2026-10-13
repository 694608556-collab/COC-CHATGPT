import { useEffect, useRef, useState } from 'react'
import type { CharacterData, ModuleRecord, SessionRecord } from '../../../../../src/shared/types'
import { MODULE_PLAY_STATUS_LABELS } from '../../../../../src/shared/types'
import { calculateDerived, skillFinal } from '../../../../../src/shared/coc-rules'
import type { Edit } from '../../../data/edit'
import type { MobileSnapshot } from '../../../data/types'

export function Editor(props: {
  initial: Edit
  snapshot: MobileSnapshot
  busy: boolean
  onSave(edit: Edit): Promise<void>
  onClose(): void
}) {
  const [draft, setDraft] = useState<Edit>(() => JSON.parse(JSON.stringify(props.initial)))
  const [error, setError] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(props.initial)
  const title = draft.kind === 'module' ? '编辑模组' : draft.kind === 'record' ? '编辑场次' : '编辑角色卡'
  const heading = useRef<HTMLHeadingElement>(null)
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
  function cancel() {
    if (!props.busy && (!dirty || window.confirm('放弃尚未保存的修改？'))) props.onClose()
  }
  function field(label: string, value: string | number, change: (value: string) => void, type = 'text') {
    return (
      <label className="field" key={label}>
        {label}
        <input
          required={type === 'number'}
          type={type}
          step={type === 'number' ? 'any' : undefined}
          value={value}
          onChange={(e) => change(e.target.value)}
        />
      </label>
    )
  }
  function text(label: string, value: string, change: (value: string) => void) {
    return (
      <label className="field" key={label}>
        {label}
        <textarea rows={4} value={value} onChange={(e) => change(e.target.value)} />
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
  const limits = c ? calculateDerived(c.edition, c.attrs, c.derived.luck7) : undefined
  return (
    <section className="panel editor">
      <h2 ref={heading} tabIndex={-1}>
        {title}
      </h2>
      <p className="muted">保存前会生成安全副本；取消不会改变已保存数据。</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (props.busy) return
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
              <label className="field">
                进度
                <select
                  value={draft.value.playStatus}
                  onChange={(e) =>
                    module({
                      ...draft.value,
                      playStatus: e.target.value as ModuleRecord['playStatus']
                    })
                  }
                >
                  {Object.entries(MODULE_PLAY_STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {text('KP（每行一位）', draft.value.kps.join('\n'), (value) =>
                module({ ...draft.value, kps: value.split('\n') })
              )}
              <p className="muted">已有 PC / PL 及角色关联保留；参与者管理将在后续接入。</p>
            </>
          )}
          {draft.kind === 'record' && (
            <>
              {field('场次名称', draft.value.name, (name) => record({ ...draft.value, name }))}
              <label className="field">
                所属模组
                <select
                  required
                  value={draft.value.moduleId}
                  onChange={(e) => record({ ...draft.value, moduleId: e.target.value })}
                >
                  <option value="">请选择模组</option>
                  {props.snapshot.modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
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
              {draft.value.sourceType === 'manual' ? (
                text('手动正文', draft.value.manualContent ?? '', (manualContent) =>
                  record({ ...draft.value, manualContent })
                )
              ) : (
                <p className="muted source-link">
                  在线正文和来源链接保留：{draft.value.link}
                  。本阶段不更换来源或联网重新获取。
                </p>
              )}
            </>
          )}
          {c && (
            <>
              <p>第 {c.edition} 版</p>
              {Object.entries({
                name: '姓名',
                occupation: '职业',
                age: '年龄',
                gender: '性别',
                birthplace: '出生地',
                residence: '居住地'
              }).map(([key, label]) =>
                field(label, c.basic[key as keyof typeof c.basic], (value) =>
                  character({ ...c, basic: { ...c.basic, [key]: value } })
                )
              )}
              <h3>属性</h3>
              <div className="edit-grid">
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
                          db: calculateDerived(c.edition, attrs).db,
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
              <details>
                <summary>技能点分配</summary>
                {c.skills.map((skill, index) => (
                  <section key={skill.id} className="skill-edit">
                    <h3>
                      {skill.name}
                      {skill.hidden ? '（已隐藏）' : ''} · 合计 {skillFinal(skill)}
                    </h3>
                    <div className="edit-grid">
                      {(['base', 'occupation', 'interest', 'growth'] as const).map((key) =>
                        field(
                          {
                            base: '基础',
                            occupation: '职业点',
                            interest: '兴趣点',
                            growth: '成长点'
                          }[key],
                          skill[key],
                          (value) =>
                            character({
                              ...c,
                              skills: c.skills.map((s, i) =>
                                i === index
                                  ? {
                                      ...s,
                                      [key]: value === '' ? NaN : Number(value)
                                    }
                                  : s
                              )
                            }),
                          'number'
                        )
                      )}
                    </div>
                  </section>
                ))}
              </details>
              {text('物品（每行一项）', c.items.join('\n'), (value) =>
                character({ ...c, items: value.split('\n') })
              )}
              {Object.entries(c.background).map(([key, value]) =>
                text(key, value, (value) =>
                  character({
                    ...c,
                    background: { ...c.background, [key]: value }
                  })
                )
              )}
              {text('调查员经历', c.story, (story) => character({ ...c, story }))}
              <p className="muted">
                已有武器、模组关联、职业公式和隐藏技能保留。本阶段不提供版次转换及武器、关联管理。
              </p>
            </>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={cancel}>
              取消编辑
            </button>
            <button type="submit" className="primary">
              {props.busy ? '正在保存…' : '保存修改'}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  )
}
