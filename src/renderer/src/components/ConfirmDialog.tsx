import { DialogShell } from './DialogShell'

export interface ConfirmOptions {
  title: string
  text: string
  confirmLabel?: string
  danger?: boolean
  onConfirm(): void | Promise<void>
}

export function ConfirmDialog({
  options,
  onClose
}: {
  options: ConfirmOptions
  onClose(): void
}): React.JSX.Element {
  return (
    <DialogShell title={options.title} onClose={onClose}>
      <div className="dialog-body">
        <p className="confirm-text">{options.text}</p>
      </div>
      <footer className="modal-actions">
        <button className="secondary" onClick={onClose}>
          取消
        </button>
        <button
          className={options.danger ? 'danger-button' : 'primary'}
          onClick={() => {
            onClose()
            void options.onConfirm()
          }}
        >
          {options.confirmLabel ?? '确认'}
        </button>
      </footer>
    </DialogShell>
  )
}
