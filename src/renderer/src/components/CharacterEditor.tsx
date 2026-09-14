import { useState } from 'react'
import type { CharacterData, ModuleRecord } from '../../../shared/types'
import { calculateDerived, convertCharacterEdition, skillFinal, skillPointSummary } from '../../../shared/coc-rules'
import { DialogShell } from './DialogShell2'

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
  onDelete
}: {
  character: CharacterData
  modules: ModuleRecord[]
  onClose(): void
  onSave(data: CharacterData): void
  onDelete(): void
}): React.JSX.Element {
  const [draft, setDraft] = useState(() => structuredClone(character))

  const updateBasic = (field: keyof CharacterData['basic'], value: string): void =>
    setDraft({ ...draft, basic: { ...draft.basic, [field]: value } })

  const updateAttribute = (field: keyof CharacterData['attrs'], value: number): void =>
    setDraft({ ...draft, attrs: { ...draft.attrs, [field]: value } })

  const updateBackground = (field: string, value: string): void =>
    setDraft({ ...draft, background: { ...draft.background, [field]: value } })

  const updateWeapon = (index: number, field: string, value: string): void =>
    setDraft({
      ...draft,
      weapons: draft.weapons.map((weapon, i) =>
        i === index ? { ...weapon, [field]: value } : weapon
      )
    })

  const updateModule = (moduleId: string, checked: boolean): void => {
    const moduleIds = checked
      ? [...draft.moduleIds, moduleId]
      : draft.moduleIds.filter((id) => id !== moduleId)
    setDraft({ ...draft, moduleIds, moduleId: moduleIds[0] })
  }

  const limits = calculateDerived(draft.edition, draft.attrs, draft.derived.luck7 ?? 50)
  const points = skillPointSummary(draft)
  const selectedModules = modules.filter((module) => draft.moduleIds.includes(module.id))
  const pcSuggestions = [...new Set(
    selectedModules.flatMap((module) => module.pairs.map((pair) => pair.pc).filter(Boolean))
  )]
  const nameListId = `pc-names-${draft.id}`

  return (
    <DialogShell title="调查员角色卡" onClose={onClose} wide>
      <div className="character-editor">
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
            <label>
              角色名
              <input
                list={nameListId}
                value={draft.basic.name}
                onChange={(event) => updateBasic('name', event.target.value)}
              />
              <datalist id={nameListId}>
                {pcSuggestions.map((name) => <option key={name} value={name} />)}
              </datalist>
            </label>
            <label>
              职业
              <input value={draft.basic.occupation} onChange={(event) => updateBasic('occupation', event.target.value)} />
            </label>
            <label>
              年龄
              <input value={draft.basic.age} onChange={(event) => updateBasic('age', event.target.value)} />
            </label>
            <label>
              性别
              <input value={draft.basic.gender} onChange={(event) => updateBasic('gender', event.target.value)} />
            </label>
            <label>
              出生地
              <input value={draft.basic.birthplace} onChange={(event) => updateBasic('birthplace', event.target.value)} />
            </label>
            <label>
              居住地
              <input value={draft.basic.residence} onChange={(event) => updateBasic('residence', event.target.value)} />
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
                  value={draft.attrs[field]}
                  onChange={(event) => updateAttribute(field, Number(event.target.value))}
                />
              </label>
            ))}
          </div>
          <div className="derived">
            <span>生命 <b>{limits.hp}</b></span>
            <span>魔法 <b>{limits.mp}</b></span>
            <span>理智 <b>{limits.san}</b></span>
            <span>幸运 <b>{draft.edition === 6 ? draft.attrs.POW * 5 : (draft.derived.luck7 ?? 50)}</b></span>
            <span>移动 <b>8</b></span>
          </div>
        </section>

        <section>
          <h3>技能点数上限</h3>
          <div className="form-grid two-columns">
            <label>
              职业技能（EDU × 4）
              <input value={points.occupationLimit} readOnly />
            </label>
            <label>
              个人兴趣（INT × 2）
              <input value={points.interestLimit} readOnly />
            </label>
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
                <button className="icon-button danger" onClick={() => setDraft({ ...draft, weapons: draft.weapons.filter((_, i) => i !== index) })}>
                  删除
                </button>
              </div>
            ))}
            <button className="secondary" onClick={() => setDraft({ ...draft, weapons: [...draft.weapons, {}] })}>
              + 添加武器
            </button>
          </div>
        </section>

        <section>
          <h3>技能</h3>
          <div className="skill-table-wrap">
            <table className="skill-table">
              <thead><tr><th>技能</th><th>基础</th><th>职业</th><th>兴趣</th><th>成长</th><th>合计</th></tr></thead>
              <tbody>
                {draft.skills.map((skill, index) => (
                  <tr key={skill.id}>
                    <td><input value={skill.name} onChange={(event) => setDraft({ ...draft, skills: draft.skills.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} /></td>
                    {(['base', 'occupation', 'interest', 'growth'] as const).map((field) => (
                      <td key={field}><input type="number" value={skill[field]} onChange={(event) => setDraft({ ...draft, skills: draft.skills.map((item, i) => i === index ? { ...item, [field]: Number(event.target.value) } : item) })} /></td>
                    ))}
                    <td>{skillFinal(skill)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="character-detail-grid">
          <section>
            <h3>财产与装备</h3>
            {draft.items.map((item, index) => (
              <div className="item-row" key={index}>
                <input
                  value={item}
                  onChange={(event) => setDraft({ ...draft, items: draft.items.map((value, i) => i === index ? event.target.value : value) })}
                />
                <button className="icon-button danger" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })}>删除</button>
              </div>
            ))}
            <button className="secondary" onClick={() => setDraft({ ...draft, items: [...draft.items, ''] })}>+ 添加物品</button>
          </section>
          <section>
            <h3>背景详情</h3>
            {BG_FIELDS.map(([field, label]) => (
              <label key={field}>
                {label}
                <input value={draft.background[field] ?? ''} onChange={(event) => updateBackground(field, event.target.value)} />
              </label>
            ))}
          </section>
        </div>

        <section>
          <h3>背景故事</h3>
          <textarea rows={5} value={draft.story} onChange={(event) => setDraft({ ...draft, story: event.target.value })} />
        </section>
      </div>
      <footer className="modal-actions">
        <button className="danger-link" onClick={onDelete}>删除角色卡</button>
        <span className="spacer" />
        <button className="secondary" onClick={onClose}>取消</button>
        <button className="primary" onClick={() => onSave(draft)}>保存</button>
      </footer>
    </DialogShell>
  )
}
