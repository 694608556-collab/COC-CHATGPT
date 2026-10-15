import { useEffect, useId, useRef, useState } from 'react'
import type { CharacterData } from '../../../../../../../src/shared/types'

export function CharacterSuggest(props: {
  label: string
  value: string
  characterId?: string
  characters: CharacterData[]
  onChange(value: string, characterId?: string): void
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const wrap = useRef<HTMLDivElement>(null)
  const id = useId()
  const rows = props.characters.filter(
    (c) => !props.value || props.characterId || c.basic.name.toLowerCase().includes(props.value.toLowerCase())
  )
  useEffect(() => {
    const close = (event: Event) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    /** @returns 无返回值；系统返回先关闭候选，不丢弃角色关联草稿。 */
    function dismiss() {
      setOpen(false)
    }
    window.addEventListener('logbook-dropdown-close', dismiss)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
      window.removeEventListener('logbook-dropdown-close', dismiss)
    }
  }, [])
  function choose(character: CharacterData) {
    props.onChange(character.basic.name, character.id)
    setOpen(false)
  }
  return (
    <div className="field combo-field" ref={wrap}>
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && !!rows.length}
        aria-controls={id + '-options'}
        aria-activedescendant={open && highlight >= 0 ? id + '-option-' + highlight : undefined}
        value={props.value}
        placeholder="输入姓名或选择角色"
        onFocus={() => {
          setOpen(true)
          setHighlight(-1)
        }}
        onChange={(event) => {
          props.onChange(event.target.value)
          setOpen(true)
          setHighlight(-1)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            setOpen(false)
          }
          if (event.key === 'ArrowDown' && rows.length) {
            event.preventDefault()
            setOpen(true)
            setHighlight((highlight + 1) % rows.length)
          }
          if (event.key === 'ArrowUp' && rows.length) {
            event.preventDefault()
            setOpen(true)
            setHighlight(highlight < 0 ? rows.length - 1 : (highlight + rows.length - 1) % rows.length)
          }
          if (event.key === 'Enter' && open && highlight >= 0 && rows[highlight]) {
            event.preventDefault()
            choose(rows[highlight]!)
          }
        }}
      />
      {open && !!rows.length && (
        <ul
          id={id + '-options'}
          className="combo-options"
          data-app-dropdown
          role="listbox"
          aria-label={props.label + '角色候选'}
        >
          {rows.map((c, i) => (
            <li
              key={c.id}
              id={id + '-option-' + i}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(c)}
            >
              <strong>{c.basic.name || '未命名角色'}</strong>
              <small>
                {c.edition} 版 · {c.basic.occupation || '职业未填写'}
              </small>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
