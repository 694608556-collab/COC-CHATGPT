import { useState } from 'react'
import type { CharacterData } from '../../../../../src/shared/types'
import { skillFinal } from '../../../../../src/shared/coc-rules'

/**
 * 首阶段完整角色字段只读浏览；不恢复已删除的 Excel/PDF 导出。
 * @param props - 已导入并校验的角色卡集合。
 * @returns 角色列表、属性、技能及背景信息。
 */
export function CharacterCards(props: { characters: CharacterData[] }) {
  const [selected, setSelected] = useState('')
  const character = props.characters.find((c) => c.id === selected)
  if (!character)
    return (
      <>
        <p className="muted">首阶段提供已有角色卡浏览，编辑功能尚未接入。</p>
        {props.characters.map((c) => (
          <button key={c.id} className="record-card" onClick={() => setSelected(c.id)}>
            <strong>{c.basic.name || '未命名角色'}</strong>
            <span>
              {c.edition} 版 · {c.basic.occupation || '职业未填写'}
            </span>
          </button>
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
      <button onClick={() => setSelected('')}>返回角色列表</button>
      <section className="panel">
        <h2>{character.basic.name || '未命名角色'}</h2>
        <p>
          {character.edition} 版 · {character.basic.occupation}
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
        {character.skills
          .filter((s) => !s.hidden)
          .map((s) => (
            <div className="skill-row" key={s.id}>
              <span>{s.name}</span>
              <strong>{skillFinal(s)}</strong>
            </div>
          ))}
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
