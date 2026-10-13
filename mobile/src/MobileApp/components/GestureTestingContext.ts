import { createContext } from 'react'

export interface GestureTestSource {
  id: string
  group: string
  label: string
  drop(targetId: string): void
}

/** Optional browser-preview controls; the Android entry never supplies this context. */
export const GestureTestingContext = createContext<
  | {
      enabled: boolean
      source?: GestureTestSource
      start(source: GestureTestSource): void
      cancel(): void
    }
  | undefined
>(undefined)
