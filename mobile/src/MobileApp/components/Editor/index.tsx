import { useEffect, useRef, useState } from 'react'
import type { CharacterData, ModuleRecord, SessionRecord } from '../../../../../src/shared/types'
import { MODULE_PLAY_STATUS_LABELS } from '../../../../../src/shared/types'
import {
  calculateDerived,
  skillFinal,
  convertCharacterEdition,
  createSkill
} from '../../../../../src/shared/coc-rules'
import type { Edit } from '../../../data/edit'
import type { MobileSnapshot } from '../../../data/types'
import { RemoveButton } from '../RemoveButton'
import { CharacterSuggest } from '../CharacterSuggest'

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
  useEffect(() => {
    window.addEventListener('logbook-editor-back', cancel)
    return () => window.removeEventListener('logbook-editor-back', cancel)
  })
  function field(label: string, value: string | number, change: (value: string) => void, type = 'text') {
    return (
      <label className="field" key={label}>
        {label}
        <input
          required={type === 'number'}
          type={type}
          step={type === 'number' ? 'any' : undefined}
          value={typeof value === 'number' && !Number.isFinite(value) ? '' : value}
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
              <label className="field">
                正文来源
                <select
                  value={draft.value.sourceType}
                  onChange={(e) => {
                    if (window.confirm('更换来源后，保存时会清除旧来源正文。继续？'))
                      record({ ...draft.value, sourceType: e.target.value as 'manual' | 'online' })
                  }}
                >
                  <option value="manual">手动正文</option>
                  <option value="online">海豹日志链接</option>
                </select>
              </label>
              {draft.value.sourceType === 'manual'
                ? text('手动正文', draft.value.manualContent ?? '', (manualContent) =>
                    record({ ...draft.value, manualContent })
                  )
                : field('海豹日志链接', draft.value.link ?? '', (link) => record({ ...draft.value, link }))}
            </>
          )}
          {c && (
            <>
              <label className="field">
                角色规则版次
                <select
                  aria-label="角色规则版次"
                  value={c.edition}
                  onChange={(e) => {
                    if (window.confirm('按已有规则转换属性及派生值，并保留另一版属性快照。继续？'))
                      character(convertCharacterEdition(c, Number(e.target.value) as 6 | 7))
                  }}
                >
                  <option value={6}>第六版</option>
                  <option value={7}>第七版</option>
                </select>
              </label>
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
                    }}
                  />
                  {m.name}
                </label>
              ))}
              <p className="muted">移除归属会解除该模组内的角色关联，保留 PC/PL 姓名。</p>
              <div className="edit-grid basic-fields">
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
              {c.edition === 7 &&
                field('职业技能点公式', c.occupationFormula, (occupationFormula) =>
                  character({ ...c, occupationFormula })
                )}
              <details>
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
                        type="number"
                        required
                        step="any"
                        value={Number.isFinite(skillFinal(skill)) ? skillFinal(skill) : ''}
                        onChange={(event) =>
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
                        }
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
                      {Object.entries({
                        name: '名称',
                        hit: '命中',
                        damage: '伤害',
                        range: '射程',
                        times: '次数',
                        ammo: '装弹',
                        durability: '耐久'
                      }).map(([key, label]) =>
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
              <div className="item-editor-grid">
                {c.items.map((item, index) => (
                  <div className="item-edit-row" key={index}>
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
                  text(
                    (
                      {
                        description: '个人描述',
                        belief: '思想与信念',
                        importantPerson: '重要之人',
                        significantPlace: '意义非凡之地',
                        treasure: '宝贵之物',
                        trait: '特质',
                        secret: '难言之隐',
                        wound: '伤口和疤痕',
                        phobia: '恐惧症/狂躁症'
                      } as Record<string, string>
                    )[key] ?? key,
                    value,
                    (value) =>
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
