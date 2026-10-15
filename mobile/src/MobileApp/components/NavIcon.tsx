export function NavIcon({ page }: { page: 'records' | 'characters' | 'settings' }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {page === 'records' ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M8 8h8M8 12h8M8 16h8" />
        </>
      ) : page === 'characters' ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <circle cx="9" cy="10" r="2.2" />
          <path d="M5.8 16a3.2 3.2 0 0 1 6.4 0M15 9h3M15 13h3M15 16h2" />
        </>
      ) : (
        <>
          <path d="m9.5 3-.6 2.1-1.8 1-2.2-.5-2.5 4.3 1.6 1.6v2L2.4 15l2.5 4.3 2.2-.5 1.8 1 .6 2.2h5l.6-2.2 1.8-1 2.2.5 2.5-4.3-1.6-1.5v-2l1.6-1.6-2.5-4.3-2.2.5-1.8-1L14.5 3Z" />
          <circle cx="12" cy="12.5" r="3" />
        </>
      )}
    </svg>
  )
}
