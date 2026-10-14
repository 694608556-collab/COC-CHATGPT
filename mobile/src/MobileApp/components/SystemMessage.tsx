import { useEffect, useRef, useState } from 'react'

/** Closing feedback never cancels work or changes stored data. */
export function SystemMessage(props: {
  message: string
  kind?: 'notice' | 'error' | 'warning' | 'progress'
  autoHide?: boolean
  ariaLabel?: string
  onDismiss?(): void
}) {
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
      {kind === 'progress' && <span className="busy-spinner" aria-hidden="true" />}
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
