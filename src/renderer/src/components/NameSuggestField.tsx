import { useEffect, useId, useRef, useState } from 'react'

export function NameSuggestField({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: string[]
  onChange(value: string): void
}): React.JSX.Element {
  const inputId = useId()
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)

  const query = value.trim().toLowerCase()
  const filtered = query ? options.filter((item) => item.toLowerCase().includes(query)) : options

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open) setHighlight(-1)
  }, [open])

  const commit = (next: string): void => {
    onChange(next)
    setOpen(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!filtered.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlight((current) => (current + 1) % filtered.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setHighlight((current) => (current <= 0 ? filtered.length - 1 : current - 1))
    } else if (event.key === 'Enter' && open && highlight >= 0) {
      event.preventDefault()
      const target = filtered[highlight]
      if (target !== undefined) commit(target)
    }
  }

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <div className="combo" ref={wrapRef}>
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open && filtered.length > 0}
          aria-autocomplete="list"
          aria-controls={inputId + '-list'}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        <span className="combo-caret" aria-hidden="true">
          {'\u25be'}
        </span>
        {open && filtered.length > 0 && (
          <ul className="combo-list" id={inputId + '-list'} role="listbox">
            {filtered.map((item, index) => (
              <li
                key={item}
                role="option"
                aria-selected={index === highlight}
                className={index === highlight ? 'active' : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(item)}
                onMouseEnter={() => setHighlight(index)}
              >
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
