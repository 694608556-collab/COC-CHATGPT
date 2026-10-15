import type { PresentationPort } from '../data/presentation'

/**
 * 浏览器专用展示存储，与 IndexedDB 业务快照分离；生产入口不导入本文件。
 * @returns 与原生相同的一次性展示许可接口；不提供重置业务数据联动。
 */
export function browserPresentation(): PresentationPort {
  return {
    async claimFirstLaunchIntro() {
      const key = 'coc-logbook-first-welcome-shown'
      if (localStorage.getItem(key) === '1') return { show: false }
      localStorage.setItem(key, '1')
      return { show: true }
    }
  }
}
