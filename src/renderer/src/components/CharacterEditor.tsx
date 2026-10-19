import type { Coc7ImportSummary } from '../../../shared/coc7-import'
import { useState } from 'react'
import type { CharacterData, ModuleRecord } from '../../../shared/types'
import { calculateDerived, convertCharacterEdition, createSkill } from '../../../shared/coc-rules'
import { DialogShell } from './DialogShell'
import { PlusIcon, XIcon } from './Icons'
import { NameSuggestField } from './NameSuggestField'

const ATTR_LABELS: Record<keyof CharacterData['attrs'], string> = {
  STR: '力量',
  CON: '体质',
  SIZ: '体型',
  DEX: '敏捷',
  APP: '外貌',
  INT: '智力',
  POW: '意志',
  EDU: '教育'
}

const BG_FIELDS = [
  ['description', '个人描述'],
  ['belief', '思想与信念'],
  ['importantPerson', '重要之人'],
  ['significantPlace', '意义非凡之地'],
  ['treasure', '宝贵之物'],
  ['trait', '特质'],
  ['secret', '难言之隐'],
  ['wound', '伤口和疤痕'],
  ['phobia', '恐惧症 / 狂躁症']
] as const

const WEAPON_FIELDS = [
  ['name', '名称'],
  ['hit', '命中'],
  ['damage', '伤害'],
  ['range', '射程'],
  ['times', '次数'],
  ['ammo', '装弹'],
  ['durability', '耐久']
] as const

export function CharacterEditor({
  character,
  modules,
  onClose,
  onSave,
  onDelete,
  importSummary
}: {
  character: CharacterData
  modules: ModuleRecord[]
  onClose(): void
  onSave(data: CharacterData): void | Promise<void>
  onDelete?(): void
  /** 七版导入的待补填字段，仅在草稿存在。 */
  importSummary?: Coc7ImportSummary
}): React.JSX.Element {
  const [draft, setDraft] = useState(() => {
    const next = structuredClone(character)
    next.skills = next.skills.map((skill) => ({
      ...skill,
      occupation: 0,
      interest: 0,
      growth: 0
    }))
    return next
  })

  const [issues, setIssues] = useState(importSummary?.issues ?? [])
  const [saving, setSaving] = useState(false)
  const activeIssues = issues.filter(
    (issue) =>
      !issue.key.startsWith('skill:') || draft.skills.some((skill) => issue.key === `skill:${skill.id}`)
  )

  /** 用户明确输入有效值后清除导入问题，空白或负数仍保留。@param key 字段键。@param value 原始输入。@param numeric 是否数值。@returns 无返回值。 */
  const resolveIssue = (key: string, value: string, numeric = true): void => {
    if (!value.trim() || (numeric && (!Number.isFinite(Number(value)) || Number(value) < 0))) return
    setIssues((current) => current.filter((issue) => issue.key !== key))
  }

  /** 生成数值控件的导入提示属性。@param key 问题键。@param value 当前数值。@returns 显示值和无障碍错误提示。 */
  const numericProps = (key: string, value: number | undefined) => {
    const issue = issues.find((item) => item.key === key)
    return {
      value: issue ? '' : (value ?? 0),
      'aria-invalid': issue ? true : undefined,
      title: issue?.message
    }
  }

  /** 防止重复提交；失败由父级显示错误且保留草稿。@returns 无返回值。 */
  const saveDraft = async (): Promise<void> => {
    if (saving || activeIssues.length) return
    setSaving(true)
    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  const updateBasic = (field: keyof CharacterData['basic'], value: string): void =>
    setDraft({ ...draft, basic: { ...draft.basic, [field]: value } })

  const updateAttribute = (field: keyof CharacterData['attrs'], value: number): void =>
    setDraft({ ...draft, attrs: { ...draft.attrs, [field]: value } })

  const updateBackground = (field: string, value: string): void =>
    setDraft({ ...draft, background: { ...draft.background, [field]: value } })

  const updateWeapon = (index: number, field: string, value: string): void =>
    setDraft({
      ...draft,
      weapons: draft.weapons.map((weapon, i) => (i === index ? { ...weapon, [field]: value } : weapon))
    })

  const updateModule = (moduleId: string, checked: boolean): void => {
    const moduleIds = checked
      ? [...draft.moduleIds, moduleId]
      : draft.moduleIds.filter((id) => id !== moduleId)
    setDraft({ ...draft, moduleIds, moduleId: moduleIds[0] })
  }

  const limits = calculateDerived(draft.edition, draft.attrs, draft.derived.luck7 ?? 50)
  const selectedModules = modules.filter((module) => draft.moduleIds.includes(module.id))
  const pcSuggestions = [
    ...new Set(selectedModules.flatMap((module) => module.pairs.map((pair) => pair.pc).filter(Boolean)))
  ]

  return (
    <DialogShell title="调查员角色卡" onClose={onClose} wide>
      <div className="character-editor">
        {importSummary && (
          <p>
            七版角色卡导入预览：请检查后保存；取消不会新增角色。已跳过 {importSummary.skippedSkills} 项低于 15
            的技能。
          </p>
        )}
        <div className="character-edition-row">
          <span>COC 第{draft.edition === 7 ? '七' : '六'}版</span>
          <div className="segmented">
            <button
              className={draft.edition === 7 ? 'active' : ''}
              onClick={() => setDraft(convertCharacterEdition(draft, 7))}
            >
              第七版
            </button>
            <button
              className={draft.edition === 6 ? 'active' : ''}
              onClick={() => setDraft(convertCharacterEdition(draft, 6))}
            >
              第六版
            </button>
          </div>
        </div>

        <section>
          <h3>基本资料</h3>
          <div className="form-grid two-columns">
            <div className="module-links">
              <div className="field-label">模组归属（可多选）</div>
              <div className="module-link-grid">
                {modules.map((module) => (
                  <label key={module.id}>
                    <input
                      type="checkbox"
                      checked={draft.moduleIds.includes(module.id)}
                      onChange={(event) => updateModule(module.id, event.target.checked)}
                    />
                    <span>{module.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <NameSuggestField
              invalid={issues.some((issue) => issue.key === '姓名')}
              label="角色名"
              value={draft.basic.name}
              options={pcSuggestions}
              onChange={(next) => {
                updateBasic('name', next)
                resolveIssue('姓名', next, false)
              }}
            />
            <label>
              职业
              <input
                value={draft.basic.occupation}
                onChange={(event) => updateBasic('occupation', event.target.value)}
              />
            </label>
            <label>
              年龄
              <input value={draft.basic.age} onChange={(event) => updateBasic('age', event.target.value)} />
            </label>
            <label>
              性别
              <input
                value={draft.basic.gender}
                onChange={(event) => updateBasic('gender', event.target.value)}
              />
            </label>
            <label>
              出生地
              <input
                value={draft.basic.birthplace}
                onChange={(event) => updateBasic('birthplace', event.target.value)}
              />
            </label>
            <label>
              居住地
              <input
                value={draft.basic.residence}
                onChange={(event) => updateBasic('residence', event.target.value)}
              />
            </label>
          </div>
        </section>

        <section>
          <h3>属性</h3>
          <div className="attribute-grid">
            {(Object.keys(draft.attrs) as Array<keyof CharacterData['attrs']>).map((field) => (
              <label key={field}>
                {ATTR_LABELS[field]}
                <input
                  type="number"
                  {...numericProps(field, draft.attrs[field])}
                  min="0"
                  onChange={(event) => {
                    updateAttribute(field, Number(event.target.value))
                    resolveIssue(field, event.target.value)
                  }}
                />
              </label>
            ))}
          </div>
          <div className="attribute-grid">
            {(
              [
                ['hpCurrent', '当前 HP'],
                ['mpCurrent', '当前 MP'],
                ['sanCurrent', '当前 SAN'],
                ['luck7', '幸运']
              ] as const
            ).map(([field, label]) => (
              <label key={field}>
                {label}
                <input
                  type="number"
                  min="0"
                  {...numericProps(label, draft.derived[field])}
                  onChange={(event) => {
                    setDraft({ ...draft, derived: { ...draft.derived, [field]: Number(event.target.value) } })
                    resolveIssue(label, event.target.value)
                  }}
                />
              </label>
            ))}
          </div>
          <label>
            伤害加值
            <input
              value={draft.derived.db}
              onChange={(event) =>
                setDraft({ ...draft, derived: { ...draft.derived, db: event.target.value } })
              }
            />
          </label>
          <div className="derived">
            <span>
              生命 <b>{limits.hp}</b>
            </span>
            <span>
              魔法 <b>{limits.mp}</b>
            </span>
            <span>
              理智 <b>{limits.san}</b>
            </span>
            <span>
              幸运 <b>{draft.edition === 6 ? draft.attrs.POW * 5 : (draft.derived.luck7 ?? 50)}</b>
            </span>
            <span>
              移动 <b>8</b>
            </span>
          </div>
        </section>

        <section>
          <h3>武器战斗表</h3>
          <div className="weapon-table">
            {draft.weapons.map((weapon, index) => (
              <div className="weapon-row" key={index}>
                {WEAPON_FIELDS.map(([field, label]) => (
                  <label key={field}>
                    {label}
                    <input
                      value={String(weapon[field] ?? '')}
                      onChange={(event) => updateWeapon(index, field, event.target.value)}
                    />
                  </label>
                ))}
                <button
                  className="icon-button neutral-delete"
                  aria-label={`删除武器${index + 1}`}
                  onClick={() => setDraft({ ...draft, weapons: draft.weapons.filter((_, i) => i !== index) })}
                >
                  <XIcon />
                </button>
              </div>
            ))}
            <button
              className="secondary inline-add add-weapon"
              onClick={() => setDraft({ ...draft, weapons: [...draft.weapons, {}] })}
            >
              + 添加武器
            </button>
          </div>
        </section>

        <section>
          <h3>技能</h3>
          <div className="skill-editor">
            {draft.skills.map((skill, index) => (
              <div className="skill-row" key={skill.id}>
                <input
                  aria-label={`技能${index + 1}名称`}
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
                <input
                  aria-label={`技能${index + 1}点数`}
                  type="number"
                  {...numericProps(`skill:${skill.id}`, skill.base)}
                  min="0"
                  onChange={(event) => {
                    setDraft({
                      ...draft,
                      skills: draft.skills.map((item, i) =>
                        i === index ? { ...item, base: Number(event.target.value) } : item
                      )
                    })
                    resolveIssue(`skill:${skill.id}`, event.target.value)
                  }}
                />
                <button
                  className="icon-button neutral-delete"
                  aria-label={`删除技能${index + 1}`}
                  onClick={() => setDraft({ ...draft, skills: draft.skills.filter((_, i) => i !== index) })}
                >
                  <XIcon />
                </button>
              </div>
            ))}
            <button
              className="secondary add-skill"
              onClick={() => setDraft({ ...draft, skills: [...draft.skills, createSkill()] })}
            >
              <PlusIcon /> 添加技能
            </button>
          </div>
        </section>

        <div className="character-detail-grid">
          <section>
            <div className="section-heading-with-action">
              <h3>财产与装备</h3>
              <button
                className="secondary inline-add add-item"
                onClick={() => setDraft({ ...draft, items: [...draft.items, ''] })}
              >
                + 添加物品
              </button>
            </div>
            <div className="item-grid">
              {draft.items.map((item, index) => (
                <div className="item-row" key={index}>
                  <input
                    aria-label={`物品${index + 1}`}
                    value={item}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        items: draft.items.map((value, i) => (i === index ? event.target.value : value))
                      })
                    }
                  />
                  <button
                    className="icon-button neutral-delete"
                    aria-label={`删除物品${index + 1}`}
                    onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })}
                  >
                    <XIcon />
                  </button>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h3>背景详情</h3>
            {BG_FIELDS.map(([field, label]) => (
              <label
                className={
                  field === 'phobia'
                    ? 'background-field background-wide'
                    : `background-field background-${field}`
                }
                key={field}
              >
                {label}
                <input
                  value={draft.background[field] ?? ''}
                  onChange={(event) => updateBackground(field, event.target.value)}
                />
              </label>
            ))}
          </section>
        </div>

        <section>
          <h3>背景故事</h3>
          <textarea
            className="story-textarea"
            rows={8}
            value={draft.story}
            onChange={(event) => setDraft({ ...draft, story: event.target.value })}
          />
        </section>
      </div>
      {activeIssues.length > 0 && (
        <div className="import-field-warning" role="status">
          导入待补填提醒：
          {activeIssues.map((issue) => issue.message.replace(/[，,]请在此补填[。.]?/g, '')).join('；')}
        </div>
      )}
      {importSummary && importSummary.warnings.length > 0 && <p>{importSummary.warnings.join('；')}</p>}
      <footer className="modal-actions">
        {onDelete && (
          <button className="danger-link" onClick={onDelete}>
            删除角色卡
          </button>
        )}
        <span className="spacer" />
        <button className="secondary" onClick={onClose}>
          取消
        </button>
        <button
          className="primary"
          disabled={saving || activeIssues.length > 0}
          onClick={() => void saveDraft()}
        >
          保存
        </button>
      </footer>
    </DialogShell>
  )
}
