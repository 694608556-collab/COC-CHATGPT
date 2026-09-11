import type { CocApi } from '../../shared/api'

declare global {
  interface Window {
    coc: CocApi
  }
}

export {}
