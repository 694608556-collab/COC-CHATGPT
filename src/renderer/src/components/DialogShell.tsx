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
          {/*
            关闭键的 aria-label 必须直接写中文。

            此前这里是一个反斜杠 u 形式的转义（形如 \u5173\u95ed...），但 JSX 属性
            是**字符串字面量**，里面的转义不会被解析，于是无障碍名称变成了那串
            反斜杠文本：屏幕阅读器读不出来，自动化也定位不到这个按钮
            （0.8.2 做演示脚本时才发现——找「关闭对话框」一个都找不到）。
            想用转义必须写成 JS 表达式 {'\uXXXX'}，直接写中文更直观。
            这个写法从 0.3.0 起就存在，影响了所有用 DialogShell 的弹窗。
          */}
          <button className="icon-button" aria-label="关闭对话框" onClick={onClose}>
            {'\u00d7'}
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}
