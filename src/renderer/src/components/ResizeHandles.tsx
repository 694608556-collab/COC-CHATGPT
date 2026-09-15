type Direction = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const directions: Direction[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

const MIN_WIDTH = 960
const MIN_HEIGHT = 640

export function ResizeHandles({
  disabled
}: {
  disabled: boolean
}): React.JSX.Element | null {
  if (disabled) return null

  const startResize = async (
    direction: Direction,
    event: React.PointerEvent<HTMLDivElement>
  ): Promise<void> => {
    event.preventDefault()
    const initial = await window.coc.window.getBounds()
    const startX = event.screenX
    const startY = event.screenY

    const move = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.screenX - startX
      const dy = moveEvent.screenY - startY
      let { x, y, width, height } = initial

      if (direction.includes('e')) width = Math.max(MIN_WIDTH, width + dx)
      if (direction.includes('s')) height = Math.max(MIN_HEIGHT, height + dy)
      if (direction.includes('w')) {
        width = Math.max(MIN_WIDTH, width - dx)
        x = initial.x + initial.width - width
      }
      if (direction.includes('n')) {
        height = Math.max(MIN_HEIGHT, height - dy)
        y = initial.y + initial.height - height
      }

      void window.coc.window.setBounds({ x, y, width, height })
    }

    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  return (
    <>
      {directions.map((direction) => (
        <div
          key={direction}
          className={`resize-handle resize-${direction}`}
          onPointerDown={(event) => void startResize(direction, event)}
        />
      ))}
    </>
  )
}
