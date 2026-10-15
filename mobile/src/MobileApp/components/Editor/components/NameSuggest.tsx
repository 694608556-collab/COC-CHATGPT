import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useVisibleViewport } from '../../../useVisibleViewport'

/** 姓名候选只填角色姓名，不建立或修改模组参与者绑定。 */
export function NameSuggest(props: { value: string; names: string[]; onChange(name: string): void }) {
  const id = useId(),
    wrap = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null),
    list = useRef<HTMLUListElement>(null)
  const viewport = useVisibleViewport()
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number }>()
  const [open, setOpen] = useState(false),
    [filter, setFilter] = useState(''),
    [highlight, setHighlight] = useState(-1)
  const rows = props.names.filter((name) => name.toLowerCase().includes(filter.trim().toLowerCase()))
  useLayoutEffect(() => {
    if (!open || !rows.length) {
      setPosition(undefined)
      return
    }
    let frame = 0
    const place = () => {
      const box = input.current?.getBoundingClientRect()
      if (!box) return
      const dock = document.querySelector('.navigation-dock')?.getBoundingClientRect()
      const header = document.querySelector('.app-header')?.getBoundingClientRect()
      const top = Math.max(viewport.top + 8, (header?.bottom ?? 0) + 8)
      const bottom = Math.min(viewport.top + viewport.height - 8, (dock?.top ?? Infinity) - 8)
      if (box.bottom <= top || box.top >= bottom) {
        setPosition(undefined)
        return
      }
      const below = Math.max(0, bottom - box.bottom - 4)
      const above = Math.max(0, box.top - top - 4)
      const natural = Math.min(220, rows.length * 44 + 10)
      const upward = below < natural && above > below
      const maxHeight = Math.min(natural, upward ? above : below)
      if (maxHeight < 20) {
        setPosition(undefined)
        return
      }
      const width = Math.min(box.width, Math.max(0, viewport.width - 16))
      const next = {
        top: upward ? box.top - maxHeight - 4 : box.bottom + 4,
        left: Math.max(viewport.left + 8, Math.min(box.left, viewport.left + viewport.width - width - 8)),
        width,
        maxHeight
      }
      setPosition((current) =>
        current &&
        Object.keys(next).every((key) => current[key as keyof typeof next] === next[key as keyof typeof next])
          ? current
          : next
      )
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }
    place()
    window.addEventListener('scroll', schedule, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [open, rows.length, viewport])
  useEffect(() => {
    const menu = list.current,
      item = menu?.children.item(highlight) as HTMLElement | null
    if (!menu || !item) return
    if (item.offsetTop < menu.scrollTop) menu.scrollTop = item.offsetTop
    else if (item.offsetTop + item.offsetHeight > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = item.offsetTop + item.offsetHeight - menu.clientHeight
  }, [highlight, position])
  useEffect(() => {
    const close = (event: Event) => {
      if (!wrap.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node))
        setOpen(false)
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
        aria-expanded={open && !!rows.length && !!position}
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
      {open &&
        !!rows.length &&
        position &&
        createPortal(
          <ul
            ref={list}
            id={id + '-names'}
            className="combo-options viewport-name-options"
            style={position}
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
          </ul>,
          document.body
        )}
    </div>
  )
}
