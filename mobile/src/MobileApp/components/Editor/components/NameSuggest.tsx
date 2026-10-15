import { useEffect, useId, useRef, useState } from 'react'

/** 姓名候选只填角色姓名，不建立或修改模组参与者绑定。 */
export function NameSuggest(props: { value: string; names: string[]; onChange(name: string): void }) {
  const id = useId(),
    wrap = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false),
    [filter, setFilter] = useState(''),
    [highlight, setHighlight] = useState(-1)
  const rows = props.names.filter((name) => name.toLowerCase().includes(filter.trim().toLowerCase()))
  useEffect(() => {
    const close = (event: Event) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    const dismiss = () => setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    window.addEventListener('logbook-dropdown-close', dismiss)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
      window.removeEventListener('logbook-dropdown-close', dismiss)
    }
  }, [])
  function choose(name: string) {
    props.onChange(name)
    setOpen(false)
    setHighlight(-1)
  }
  return (
    <div
      className="field combo-field"
      ref={wrap}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false)
      }}
    >
      <label htmlFor={id}>姓名</label>
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && !!rows.length}
        aria-controls={id + '-names'}
        aria-activedescendant={open && rows[highlight] ? id + '-name-' + highlight : undefined}
        value={props.value}
        onFocus={() => {
          setOpen(true)
          setFilter('')
          setHighlight(-1)
        }}
        onClick={() => {
          if (!open) {
            setOpen(true)
            setFilter('')
            setHighlight(-1)
          }
        }}
        onChange={(event) => {
          props.onChange(event.target.value)
          setFilter(event.target.value)
          setOpen(true)
          setHighlight(-1)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            setOpen(false)
          }
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && rows.length) {
            event.preventDefault()
            setOpen(true)
            setHighlight(
              event.key === 'ArrowDown'
                ? (highlight + 1) % rows.length
                : highlight < 0
                  ? rows.length - 1
                  : (highlight + rows.length - 1) % rows.length
            )
          }
          if (event.key === 'Enter' && open && rows[highlight]) {
            event.preventDefault()
            choose(rows[highlight]!)
          }
        }}
      />
      {open && !!rows.length && (
        <ul
          id={id + '-names'}
          className="combo-options"
          data-app-dropdown
          role="listbox"
          aria-label="模组PC姓名候选"
        >
          {rows.map((name, i) => (
            <li
              key={name}
              id={id + '-name-' + i}
              role="option"
              aria-selected={highlight === i}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(name)}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
