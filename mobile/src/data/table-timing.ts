/** Opt-in, content-free measurements. Each duration uses its own process's monotonic clock. */
export interface TablePhaseTiming {
  clock: 'worker-monotonic' | 'native-monotonic'
  totalMs: number
  /** Consecutive, non-overlapping slices; compare/write includes comparison and SQL work. */
  phasesMs: Record<string, number>
}

export interface TableConfirmTiming {
  clock: 'webview-monotonic'
  /** From dispatching preparation to receiving the commit reply; excludes the user's confirmation. */
  totalMs: number
  prepareRoundTripMs: number
  bridgeRoundTripMs: number
  worker?: TablePhaseTiming
  native?: TablePhaseTiming
}
