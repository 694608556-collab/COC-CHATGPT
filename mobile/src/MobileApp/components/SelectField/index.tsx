import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

/** 下拉选项，不把显示名称当作存储标识。 */
export interface SelectOption {
  /** 稳定选项值，类型为 string；空串可表示尚未选择。 */
  value: string
  /** 用户可见名称，类型为 string。 */
  label: string
}

/** 三个手机页面共用的可访问选择控件。 */
interface SelectFieldProps {
  /** 显示及读屏标签，类型为 string。 */
  label: string
  /** 当前持久化或草稿值，类型为 string。 */
  value: string
  /** 可选项，类型为 SelectOption[]。 */
  options: SelectOption[]
  /** 是否禁用，类型为 boolean | undefined。 */
  disabled?: boolean
  /** 确认选择后的回调；返回 void，不直接写入数据。 */
  onChange(value: string): void
}

/** 视口内的菜单几何，所有数值均为 CSS px。 */
interface MenuPosition {
  /** 菜单上边位置，类型为 number。 */
  top: number
  /** 菜单左边位置，类型为 number。 */
  left: number
  /** 菜单宽度，类型为 number。 */
  width: number
  /** 最大滚动高度，类型为 number。 */
  maxHeight: number
}

/**
 * 自绘下拉，避免 Android/Windows 原生选择列表使用系统字体与蓝色高亮。
 * @param props - 选项、当前值、标签、忙状态和草稿更新回调。
 * @returns 应用风格的选择按钮及打开时的视口内菜单，不依赖新式 Popover API。
 */
export function SelectField(props: SelectFieldProps) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const optionNodes = useRef(new Map<string, HTMLButtonElement>())
  const [position, setPosition] = useState<MenuPosition>()
  const [highlight, setHighlight] = useState(0)
  const selected = props.options.find((option) => option.value === props.value)
  const selectedIndex = Math.max(
    0,
    props.options.findIndex((option) => option.value === props.value)
  )

  /** @returns 无返回值；关闭菜单并将键盘焦点交回触发按钮。 */
  function close() {
    setPosition(undefined)
    trigger.current?.focus()
  }

  /** @returns 无返回值；从当前选项打开菜单，必要时翻到按钮上方。 */
  function open() {
    if (props.disabled || !props.options.length || !trigger.current) return
    const rect = trigger.current.getBoundingClientRect()
    const viewportHeight = window.visualViewport?.height ?? innerHeight
    const viewportWidth = window.visualViewport?.width ?? innerWidth
    const below = viewportHeight - rect.bottom - 12
    const above = rect.top - 12
    const natural = Math.min(288, props.options.length * 44 + 12)
    const upward = below < natural && above > below
    const maxHeight = Math.min(natural, Math.max(44, upward ? above : below))
    const width = Math.min(rect.width, viewportWidth - 24)
    setHighlight(selectedIndex)
    setPosition({
      top: upward ? Math.max(12, rect.top - maxHeight - 4) : rect.bottom + 4,
      left: Math.max(12, Math.min(rect.left, viewportWidth - width - 12)),
      width,
      maxHeight
    })
  }

  /** @param value - 用户选择的稳定选项值。 @returns 无返回值；禁用期间不更新草稿。 */
  function choose(value: string) {
    if (props.disabled) return
    props.onChange(value)
    close()
  }

  useEffect(() => {
    if (!position) return
    const option = optionNodes.current.get(props.options[highlight]?.value ?? '')
    option?.focus({ preventScroll: true })
    // 只滚动菜单内部，不让键盘移动选项时把编辑页面一起拉动。
    if (option && list.current) {
      if (option.offsetTop < list.current.scrollTop) list.current.scrollTop = option.offsetTop
      else if (option.offsetTop + option.offsetHeight > list.current.scrollTop + list.current.clientHeight)
        list.current.scrollTop = option.offsetTop + option.offsetHeight - list.current.clientHeight
    }
  }, [position, highlight])

  useEffect(() => {
    if (props.disabled) setPosition(undefined)
  }, [props.disabled])

  useEffect(() => {
    if (!position) return
    /** @param event - 点击或触摸菜单外部的事件。 @returns 无返回值；不阻止目标正常操作。 */
    function outside(event: Event) {
      const target = event.target as Node
      if (!trigger.current?.contains(target) && !list.current?.contains(target)) setPosition(undefined)
    }
    /** @returns 无返回值；后台/返回/视口变化关闭菜单，不改变当前选项。 */
    function dismiss() {
      setPosition(undefined)
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('touchstart', outside)
    document.addEventListener('focusin', outside)
    window.addEventListener('resize', dismiss)
    window.visualViewport?.addEventListener('resize', dismiss)
    window.addEventListener('logbook-dropdown-close', dismiss)
    window.addEventListener('logbook-gesture-reset', dismiss)
    window.addEventListener('pagehide', dismiss)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('touchstart', outside)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('resize', dismiss)
      window.visualViewport?.removeEventListener('resize', dismiss)
      window.removeEventListener('logbook-dropdown-close', dismiss)
      window.removeEventListener('logbook-gesture-reset', dismiss)
      window.removeEventListener('pagehide', dismiss)
    }
  }, [!!position])

  /**
   * 在菜单中移动键盘焦点；Esc 只关闭菜单，不触发编辑丢弃。
   * @param event - 当前选项的键盘事件。
   * @param index - 当前焦点选项索引。
   * @returns 无返回值。
   */
  function optionKey(event: KeyboardEvent, index: number) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    let next = index
    if (event.key === 'ArrowDown') next = (index + 1) % props.options.length
    else if (event.key === 'ArrowUp') next = (index + props.options.length - 1) % props.options.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = props.options.length - 1
    else return
    event.preventDefault()
    setHighlight(next)
  }

  return (
    <div className="field dropdown-field">
      <label htmlFor={id}>{props.label}</label>
      <button
        id={id}
        ref={trigger}
        type="button"
        className="dropdown-trigger"
        role="combobox"
        disabled={props.disabled}
        aria-label={props.label}
        aria-haspopup="listbox"
        aria-expanded={!!position}
        aria-controls={id + '-options'}
        onClick={() => (position ? close() : open())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            open()
          }
        }}
      >
        <span>{selected?.label ?? ''}</span>
        <span aria-hidden="true">{position ? '▴' : '▾'}</span>
      </button>
      {position &&
        createPortal(
          <div
            id={id + '-options'}
            ref={list}
            className="dropdown-options"
            data-app-dropdown
            role="listbox"
            aria-label={props.label}
            style={position}
          >
            {props.options.map((option, index) => (
              <button
                key={option.value}
                ref={(node) => {
                  if (node) optionNodes.current.set(option.value, node)
                  else optionNodes.current.delete(option.value)
                }}
                type="button"
                role="option"
                aria-selected={props.value === option.value}
                className={index === highlight ? 'highlighted' : ''}
                disabled={props.disabled}
                onClick={() => choose(option.value)}
                onKeyDown={(event) => optionKey(event, index)}
              >
                {option.label}
                {props.value === option.value && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}
