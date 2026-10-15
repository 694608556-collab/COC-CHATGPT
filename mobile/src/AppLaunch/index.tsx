import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { FirstLaunchIntro } from './components/FirstLaunchIntro'
import './styles.css'

/**
 * 首次欢迎动画与业务启动并行，不把动画状态写入跑团数据。
 * @param props - 已由持久化接口领取的一次展示许可和正常应用内容。
 * @returns 正常应用及最多 1.6 秒的首次欢迎层；许可不会因重渲染重新消费。
 */
export function AppLaunch(props: {
  /** 仅本次进程首次渲染时使用的 boolean 许可。 */
  showIntro: boolean
  /** 与动画并行启动的 React 应用内容。 */
  children: ReactNode
}) {
  const [visible, setVisible] = useState(props.showIntro)
  useEffect(() => {
    if (!visible) return
    const timer = window.setTimeout(() => setVisible(false), 1600)
    /** @returns 无返回值；离开应用即结束首次展示，恢复前台不出现动画残留。 */
    function hideOnBackground() {
      if (document.hidden) setVisible(false)
    }
    document.addEventListener('visibilitychange', hideOnBackground)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', hideOnBackground)
    }
  }, [visible])
  return (
    <>
      <div aria-hidden={visible ? true : undefined}>{props.children}</div>
      {visible && <FirstLaunchIntro />}
    </>
  )
}
