import type { ReactNode } from 'react'

export function DialogShell({
  title,
  children,
  onClose,
  wide = false
}: {
  title: string
  children: ReactNode
  onClose(): void
  wide?: boolean
}): React.JSX.Element {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className={wide ? 'modal dialog-wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="\u5173\u95ed\u5bf9\u8bdd\u6846"
            onClick={onClose}
          >
            {'\u00d7'}
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}
