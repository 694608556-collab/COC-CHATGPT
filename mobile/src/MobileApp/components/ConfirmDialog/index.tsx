import { useEffect, useRef } from 'react'

/**
 * 应用内异步确认卡片；默认聚焦取消，Escape 等同取消。
 * @param props - 说明文字及只接收一次选择的父级回调。
 * @returns 保留原字体、灰边与紫色确认按钮的模态卡片。
 */
export function ConfirmDialog(props: {
  /** 待确认的操作说明，类型为 string；不包含可执行 HTML。 */
  message: string
  /** 选择结果回调；true 为确认，false 为取消，无返回值。 */
  onResolve(confirmed: boolean): void
}) {
  const section = useRef<HTMLElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const resolve = useRef(props.onResolve)
  resolve.current = props.onResolve
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cancel.current?.focus()
    /** @param event - 键盘事件。 @returns 无返回值；焦点限制在确认卡片内。 */
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        resolve.current(false)
      } else if (event.key === 'Tab') {
        const buttons = section.current?.querySelectorAll<HTMLButtonElement>('button')
        if (!buttons?.length) return
        const first = buttons[0]!
        const last = buttons[buttons.length - 1]!
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      document.body.style.overflow = overflow
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  return (
    <div className="modal-backdrop confirm-backdrop">
      <section
        ref={section}
        className="panel restore-dialog confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="确认操作"
      >
        <h2>确认操作</h2>
        <p>{props.message}</p>
        <div className="dialog-actions">
          <button ref={cancel} type="button" onClick={() => props.onResolve(false)}>
            取消
          </button>
          <button type="button" className="primary" onClick={() => props.onResolve(true)}>
            确认
          </button>
        </div>
      </section>
    </div>
  )
}
