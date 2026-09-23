import { DialogShell } from './DialogShell'

export interface ConfirmOptions {
  title: string
  text: string
  confirmLabel?: string
  danger?: boolean
  onConfirm(): void | Promise<void>
  /**
   * 可选的第二个动作。删除模组分组时用它给出「连资料一起移除」这个更重的选择，
   * 两个动作都以正规按钮呈现，而不是把按钮浮在对话框外面。
   */
  secondaryAction?: {
    label: string
    danger?: boolean
    onSelect(): void | Promise<void>
  }
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
        {options.secondaryAction && (
          <button
            className={options.secondaryAction.danger ? 'danger-button' : 'secondary'}
            onClick={() => {
              const action = options.secondaryAction!
              onClose()
              void action.onSelect()
            }}
          >
            {options.secondaryAction.label}
          </button>
        )}
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
