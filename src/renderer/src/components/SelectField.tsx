import { useEffect, useId, useRef, useState } from 'react'

/** 一个选项：value 为空串表示「不归属任何模组」这类特殊项 */
export interface SelectOption {
  value: string
  label: string
}

/**
 * 自绘下拉选择框。
 *
 * 为什么不用原生 `<select>`：它的**展开列表由操作系统绘制**，CSS 完全管不到
 * ——高亮条是系统蓝、字体是系统字体、圆角阴影也都不是应用那一套。用户反馈
 * 「下拉弹窗效果和应用整体风格不一致」就是这个原因（见 0.7.7）。
 *
 * 这里改成自绘：收起时是一个和输入框同款的按钮，展开时用 `.combo-list`
 * ——与「按名称联想」的 NameSuggestField 共用同一套样式，两处观感一致。
 *
 * 交互对齐原生 select：点击展开、点击选项选中、点击外部或 Esc 收起、
 * 上下键移动、Enter 选中、Home/End 跳到首尾。
 */
export function SelectField({
  label,
  value,
  options,
  onChange,
  ariaLabel
}: {
  label: string
  value: string
  options: SelectOption[]
  onChange(value: string): void
  ariaLabel?: string
}): React.JSX.Element {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex]! : undefined

  // 点击别处收起。用 mousedown 而不是 click：拖拽选择文字时也能正确收起
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  // 展开时把高亮落在当前选中项上，键盘用户一打开就在自己那一项
  useEffect(() => {
    if (open) setHighlight(selectedIndex)
    else setHighlight(-1)
  }, [open, selectedIndex])

  // 高亮项滚进可视区，长列表用键盘移动时不会「选中了却看不见」
  useEffect(() => {
    if (!open || highlight < 0) return
    const item = listRef.current?.children[highlight] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [open, highlight])

  const commit = (next: string): void => {
    onChange(next)
    setOpen(false)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        setOpen(false)
      }
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      const target = options[highlight]
      if (target) commit(target.value)
      return
    }
    if (!options.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      setHighlight((current) => (current + 1) % options.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      setHighlight((current) => (current <= 0 ? options.length - 1 : current - 1))
    } else if (event.key === 'Home' && open) {
      event.preventDefault()
      setHighlight(0)
    } else if (event.key === 'End' && open) {
      event.preventDefault()
      setHighlight(options.length - 1)
    }
  }

  return (
    <div className="resource-field">
      <label htmlFor={id}>{label}</label>
      <div className="combo select-field" ref={wrapRef} onKeyDown={onKeyDown}>
        <button
          id={id}
          type="button"
          className="select-trigger"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={id + '-list'}
          aria-label={ariaLabel ?? label}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="select-value">{selected?.label ?? ''}</span>
          <span className="select-caret" aria-hidden="true">
            {'\u25be'}
          </span>
        </button>
        {open && (
          <ul className="combo-list" id={id + '-list'} role="listbox" ref={listRef}>
            {options.map((option, index) => (
              <li
                key={option.value || '\u0000empty'}
                role="option"
                aria-selected={option.value === value}
                className={index === highlight ? 'active' : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(option.value)}
                onMouseEnter={() => setHighlight(index)}
              >
                {option.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
