import { useState, type ReactNode } from 'react'

/** A folded section need not create its input DOM until first expanded.
 * The complete draft lives in Editor throughout. Once visited, controls stay
 * mounted even when folded again, preserving native required-field validity.
 * Import issues open their section immediately, before it can be submitted. */
export function EditorDetails(props: { title: string; reveal?: boolean; children(): ReactNode }) {
  const [visited, setVisited] = useState(!!props.reveal)
  const [open, setOpen] = useState(!!props.reveal)
  return (
    <details open={open || props.reveal || undefined} onToggle={event => {
      const next = event.currentTarget.open
      setOpen(next)
      if (next) setVisited(true)
    }}>
      <summary onClick={() => setVisited(true)}>{props.title}</summary>
      {(visited || props.reveal) && props.children()}
    </details>
  )
}
