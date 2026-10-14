import { useEffect, useRef, useState } from 'react'

/** 操作结果与进行中反馈；关闭只影响可见性，不取消操作或修改数据。 */
interface SystemMessageProps {
  /** 用户可见的阶段或结果文案，类型为 string。 */
  message: string
  /** 反馈类别，类型为可选字符串联合；未提供时为 notice。 */
  kind?: 'notice' | 'error' | 'warning' | 'progress'
  /** 是否自动收起完成提示，类型为 boolean | undefined；进行中永不自动收起。 */
  autoHide?: boolean
  /** 读屏名称，类型为 string | undefined。 */
  ariaLabel?: string
  /** 提示关闭后的回调，类型为可选无参数函数；不得用于取消业务操作。 */
  onDismiss?(): void
}

/**
 * 显示轻量状态图标、原字体文案和关闭入口；完成反馈三秒后渐隐。
 * @param props - 文案、状态与仅管理提示可见性的选项。
 * @returns 可见反馈组件；收起后为 null。
 */
export function SystemMessage(props: SystemMessageProps) {
  const kind = props.kind ?? 'notice'
  const autoHide = kind !== 'progress' && props.autoHide !== false
  const [dismissed, setDismissed] = useState(false)
  const [fading, setFading] = useState(false)
  const dismissCallback = useRef(props.onDismiss)
  dismissCallback.current = props.onDismiss
  useEffect(() => {
    setDismissed(false)
    setFading(false)
    if (!autoHide) return
    const fade = setTimeout(() => setFading(true), 3000)
    const finish = setTimeout(() => {
      setDismissed(true)
      dismissCallback.current?.()
    }, 3300)
    return () => {
      clearTimeout(fade)
      clearTimeout(finish)
    }
  }, [props.message, autoHide, kind])
  if (dismissed) return null
  return (
    <div
      className={`system-message ${kind === 'progress' ? 'busy-progress' : kind}${fading ? ' fading' : ''}`}
      role={
        kind === 'progress'
          ? 'progressbar'
          : kind === 'error'
            ? 'alert'
            : kind === 'notice'
              ? 'status'
              : undefined
      }
      aria-label={props.ariaLabel}
      aria-valuetext={kind === 'progress' ? props.message : undefined}
    >
      {kind === 'progress' ? (
        <span className="busy-spinner" aria-hidden="true" />
      ) : (
        <svg
          className="message-symbol"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {kind === 'notice' ? (
            <path d="m5 12 4 4L19 6" />
          ) : (
            <>
              {kind === 'warning' ? <path d="M12 3 2 21h20L12 3Z" /> : <circle cx="12" cy="12" r="9" />}
              <path d="M12 8v5m0 4h.01" />
            </>
          )}
        </svg>
      )}
      <span className="system-message-text">{props.message}</span>
      <button
        type="button"
        className="message-close"
        aria-label={kind === 'error' ? '关闭错误提示' : '关闭提示'}
        onClick={() => {
          setDismissed(true)
          dismissCallback.current?.()
        }}
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
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  )
}
