import { useRef } from 'react'

/**
 * 正文搜索输入框：未提交显示放大镜，提交后显示清空；空文本不显示尾部操作。
 * @param props 输入文字、提交状态、无障碍名称和修改回调；提交由外层 form 处理。
 * @returns 沿用原清空按钮尺寸的受控搜索框，不在输入时执行搜索。
 */
export function SearchInput(props: {
  value: string
  submitted: boolean
  label: string
  searchLabel: string
  clearLabel: string
  placeholder: string
  onChange(value: string): void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <span className="search-input-wrap">
      <input
        ref={input}
        type="search"
        aria-label={props.label}
        enterKeyHint="search"
        placeholder={props.placeholder}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {!!props.value && (
        <button
          type={props.submitted ? 'button' : 'submit'}
          className="search-clear"
          aria-label={props.submitted ? props.clearLabel : props.searchLabel}
          onClick={
            props.submitted
              ? () => {
                  props.onChange('')
                  input.current?.focus()
                }
              : undefined
          }
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            {props.submitted ? (
              <path d="m6 6 12 12M18 6 6 18" />
            ) : (
              <>
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 5 5" />
              </>
            )}
          </svg>
        </button>
      )}
    </span>
  )
}
