type Direction = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const directions: Direction[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

const MIN_WIDTH = 960
const MIN_HEIGHT = 640

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

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
    let frame = 0
    let pending: Bounds | undefined
    let inFlight = false
    let lastSent: Bounds | undefined

    const same = (a: Bounds | undefined, b: Bounds | undefined): boolean =>
      Boolean(a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)

    // Collapse pointer bursts into one update per frame and never let more than
    // one resize request sit in the IPC queue at a time.
    const flush = (): void => {
      frame = 0
      if (inFlight || !pending) return
      if (same(pending, lastSent)) {
        pending = undefined
        return
      }
      const next = pending
      pending = undefined
      lastSent = next
      inFlight = true
      void window.coc.window.setBounds(next).finally(() => {
        inFlight = false
        if (pending) frame = window.requestAnimationFrame(flush)
      })
    }

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

      pending = { x, y, width, height }
      if (!frame) frame = window.requestAnimationFrame(flush)
    }

    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (frame) {
        window.cancelAnimationFrame(frame)
        flush()
      }
      document.body.classList.remove('window-resizing')
    }

    document.body.classList.add('window-resizing')
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
