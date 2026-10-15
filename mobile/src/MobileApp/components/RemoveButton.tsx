export function RemoveButton(props: { label: string; onClick(): void }) {
  return (
    <button type="button" className="neutral-delete" aria-label={props.label} onClick={props.onClick}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="m4 4 8 8M12 4l-8 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </button>
  )
}
