import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

/** 姓名候选只填角色姓名，不建立或修改模组参与者绑定。 */
export function NameSuggest(props: {
  value: string
  names: string[]
  requestOpen: number
  onChange(name: string): void
}) {
  const id = useId(),
    wrap = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null),
    list = useRef<HTMLUListElement>(null)
  const touchingList = useRef(false)
  const [open, setOpen] = useState(false),
    [filter, setFilter] = useState(''),
    [highlight, setHighlight] = useState(-1)
  const rows = props.names.filter((name) => name.toLowerCase().includes(filter.trim().toLowerCase()))
  useEffect(() => {
    if (!props.requestOpen) return
    // 勾选模组后直接提供姓名候选，不抢焦点或唤起键盘，不自动填写草稿。
    setOpen(true)
    setFilter('')
    setHighlight(-1)
  }, [props.requestOpen])
  useLayoutEffect(() => {
    if (open && rows.length)
      window.dispatchEvent(new CustomEvent('logbook-name-options-open', { detail: input.current }))
  }, [open, rows.length])
  useEffect(() => {
    const menu = list.current,
      item = menu?.children.item(highlight) as HTMLElement | null
    if (!menu || !item) return
    const top = item.getBoundingClientRect().top - menu.getBoundingClientRect().top - menu.clientTop
    if (top < 0) menu.scrollTop += top
    else if (top + item.offsetHeight > menu.clientHeight)
      menu.scrollTop += top + item.offsetHeight - menu.clientHeight
  }, [highlight, open])
  useEffect(() => {
    const close = (event: Event) => {
      if (!wrap.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) {
        touchingList.current = false
        setOpen(false)
      }
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
        if (
          !touchingList.current &&
          !event.currentTarget.contains(event.relatedTarget as Node) &&
          !list.current?.contains(event.relatedTarget as Node)
        )
          setOpen(false)
      }}
    >
      <label htmlFor={id}>姓名</label>
      <input
        ref={input}
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
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
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
          ref={list}
          id={id + '-names'}
          className="combo-options inline-name-options"
          data-app-dropdown
          role="listbox"
          aria-label="模组PC姓名候选"
          onPointerDown={(event) => {
            touchingList.current = true
            // 保留输入焦点以及 pan-y 的原生列表滚动。
            event.preventDefault()
          }}
          onPointerUp={() => {
            touchingList.current = false
          }}
          onPointerCancel={() => {
            touchingList.current = false
          }}
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
