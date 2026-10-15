import { Native } from './native'

/** 与 LogbookPlugin.claimFirstLaunchIntro 一致的无参、本机展示许可接口；不参与数据导入／清空。 */
export interface PresentationPort {
  /** @returns 先成功持久化已领取标记后才返回 show=true；后续调用为 false，写入失败拒绝。 */
  claimFirstLaunchIntro(): Promise<{ show: boolean }>
}

/** 复用已注册的 Logbook 原生桥接，不发起网络请求。 */
export const Presentation: PresentationPort = Native

/**
 * 领取一次欢迎许可；展示标记异常不阻断业务启动，也不以未持久化许可播放。
 * @param port - 本机展示接口，不接收或上传任何跑团数据。
 * @returns 最多等待 500ms；失败／超时 resolve false，正常返回原生 show 布尔值。
 */
export async function claimWelcome(port: PresentationPort): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      port.claimFirstLaunchIntro().then((result) => result.show === true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 500)
      })
    ])
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
