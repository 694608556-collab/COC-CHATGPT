import type { CharacterData, Edition } from '../../../../../src/shared/types'
import { skillFinal } from '../../../../../src/shared/coc-rules'
import { GestureRow } from '../GestureRow'

/**
 * 角色字段浏览与基础编辑入口；不恢复已删除的 Excel/PDF 导出。
 * @param props - 已导入并校验的角色卡集合。
 * @returns 角色列表、属性、技能及背景信息。
 */
export function CharacterCards(props: {
  characters: CharacterData[]
  onEdit(value: CharacterData): void
  onNew(edition: Edition): void
  selected: string
  onSelect(id: string): void
  onDelete(id: string): void
  busy: boolean
}) {
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
              <strong>{c.basic.name || '未命名角色'}</strong>
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
        <h2>{character.basic.name || '未命名角色'}</h2>
        <p>
          {character.edition} 版 · {character.basic.occupation || '职业未填写'} ·{' '}
          {character.basic.age ? character.basic.age + ' 岁' : '年龄未填写'}
        </p>
        <dl className="details">
          {Object.entries(character.basic).map(([key, value]) => (
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
              <dd>{value || '未填写'}</dd>
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
        <h2>装备与背景</h2>
        {character.weapons.map((w, i) => (
          <p key={i}>
            {Object.entries(w)
              .map(([k, v]) => `${k}：${v}`)
              .join(' · ')}
          </p>
        ))}
        {character.items.map((item, i) => (
          <p key={i}>{item}</p>
        ))}
        {Object.entries(character.background).map(([key, value]) => (
          <div key={key}>
            <h3>{key}</h3>
            <p className="preserve-text">{value}</p>
          </div>
        ))}
        <p className="preserve-text">{character.story}</p>
      </section>
    </>
  )
}
