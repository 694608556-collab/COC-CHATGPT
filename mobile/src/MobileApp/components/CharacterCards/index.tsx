import type { CharacterData, Edition, ModuleRecord } from '../../../../../src/shared/types'
import { skillFinal } from '../../../../../src/shared/coc-rules'
import { GestureRow } from '../GestureRow'
import { BACKGROUND_LABELS } from '../../characterLabels'
import { useItemLayout } from '../../useItemLayout'

/**
 * 角色字段浏览与基础编辑入口；不恢复已删除的 Excel/PDF 导出。
 * @param props - 已导入并校验的角色卡集合。
 * @returns 角色列表、属性、技能及背景信息。
 */
export function CharacterCards(props: {
  characters: CharacterData[]
  modules: ModuleRecord[]
  onEdit(value: CharacterData): void
  onNew(edition: Edition): void
  selected: string
  onSelect(id: string): void
  onDelete(id: string): void
  busy: boolean
}) {
  const itemLayout = useItemLayout()
  function moduleNames(c: CharacterData) {
    const ids = new Set([...c.moduleIds, ...(c.moduleId ? [c.moduleId] : [])])
    return (
      props.modules
        .filter((module) => ids.has(module.id))
        .map((module) => module.name)
        .join('、') || '未关联模组'
    )
  }
  const selected = props.selected
  const setSelected = props.onSelect
  const character = props.characters.find((c) => c.id === selected)
  if (!character)
    return (
      <>
        <div className="edit-actions">
          <button disabled={props.busy} onClick={() => props.onNew(6)}>
            新建六版角色
          </button>
          <button disabled={props.busy} onClick={() => props.onNew(7)}>
            新建七版角色
          </button>
        </div>
        {props.characters.map((c) => (
          <GestureRow
            key={c.id}
            id={c.id}
            label={'角色卡 ' + (c.basic.name || '未命名角色')}
            disabled={props.busy}
            onDelete={() => props.onDelete(c.id)}
          >
            <button className="record-card" onClick={() => setSelected(c.id)}>
              <strong className="character-title">
                {c.basic.name || '未命名角色'}
                <span className="character-modules" aria-label="关联模组">
                  {' '}
                  · {moduleNames(c)}
                </span>
              </strong>
              <span>
                {c.edition} 版 · {c.basic.occupation || '职业未填写'} ·{' '}
                {c.basic.age ? c.basic.age + ' 岁' : '年龄未填写'}
              </span>
            </button>
          </GestureRow>
        ))}
        {!props.characters.length && (
          <section className="panel empty">
            <h2>暂无角色卡</h2>
            <p>可以在数据与设置中导入电脑备份。</p>
          </section>
        )}
      </>
    )
  return (
    <>
      <div className="edit-actions">
        <button onClick={() => setSelected('')}>返回角色列表</button>
        <button disabled={props.busy} onClick={() => props.onEdit(character)}>
          编辑角色卡
        </button>
      </div>
      <section className="panel">
        <h2 className="character-title">
          {character.basic.name || '未命名角色'}
          <span className="character-modules" aria-label="关联模组">
            {' '}
            · {moduleNames(character)}
          </span>
        </h2>
        <p>
          {character.edition} 版 · {character.basic.occupation || '职业未填写'} ·{' '}
          {character.basic.age ? character.basic.age + ' 岁' : '年龄未填写'}
        </p>
        <dl className="details character-basic">
          {(['name', 'age', 'occupation', 'gender', 'birthplace', 'residence'] as const).map((key) => (
            <div key={key}>
              <dt>
                {{
                  name: '姓名',
                  occupation: '职业',
                  age: '年龄',
                  gender: '性别',
                  birthplace: '出生地',
                  residence: '居住地'
                }[key] || key}
              </dt>
              <dd>{character.basic[key] || '未填写'}</dd>
            </div>
          ))}
        </dl>
        <div className="attribute-grid">
          {Object.entries(character.attrs).map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <p>
          HP {character.derived.hpCurrent} · MP {character.derived.mpCurrent} · SAN{' '}
          {character.derived.sanCurrent}
        </p>
        <p>
          伤害加值 {character.derived.db} · 幸运{' '}
          {character.edition === 6 ? character.derived.luck6 : character.derived.luck7}
        </p>
      </section>
      <section className="panel">
        <h2>技能</h2>
        <div className="skills-display-grid">
          {character.skills
            .filter((s) => !s.hidden)
            .map((s) => (
              <div className="skill-row" key={s.id}>
                <span>{s.name}</span>
                <strong>{skillFinal(s)}</strong>
              </div>
            ))}
        </div>
      </section>
      <section className="panel">
        <h2>武器</h2>
        {character.weapons.map((w, i) => (
          <p className="weapon-display" key={i}>
            {String(w.name ?? '').trim() || '名称未填写'}
          </p>
        ))}
        {!character.weapons.length && <p className="muted">尚未填写武器。</p>}
      </section>
      <section className="panel">
        <h2>财产与装备</h2>
        {!!character.items.length && (
          <ul
            className="items-display-grid"
            aria-label="物品"
            ref={itemLayout.ref}
            style={itemLayout.gridStyle}
          >
            {character.items.map((item, i) => (
              <li key={i} style={itemLayout.itemStyle(item)}>
                {item || '未填写'}
              </li>
            ))}
          </ul>
        )}
        {!character.items.length && <p className="muted">尚未填写财产与装备。</p>}
      </section>
      <section className="panel">
        <h2>背景</h2>
        {Object.entries({
          ...Object.fromEntries(Object.keys(BACKGROUND_LABELS).map((key) => [key, ''])),
          ...character.background
        }).map(([key, value]) => (
          <div key={key}>
            <h3>{BACKGROUND_LABELS[key] ?? key}</h3>
            <p className="preserve-text">{value || '未填写'}</p>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>调查员经历</h2>
        <p className="preserve-text">{character.story || '未填写'}</p>
      </section>
    </>
  )
}
