import { Capacitor } from '@capacitor/core'
import { SystemMessage } from '../SystemMessage'

/**
 * 首次启动或授权失效的硬门禁，不提供静默默认目录。
 * @param props - 操作状态、原目录名称和用户选择事件。
 * @returns 目录确认界面。
 */
export function ArchiveGate(props: {
  busy: boolean
  label: string
  onChoose(): void
  onChooseLocal?(): void
}) {
  const ios = Capacitor.getPlatform() === 'ios'
  return (
    <section className="panel onboarding">
      <span className="badge">首次使用 · 保存位置</span>
      <h1>先确认你的归档文件夹</h1>
      <p>
        {ios
          ? '备份与导出文件保存在你选择的文件夹，可以用 iPhone 的“文件”应用访问。'
          : '备份与导出文件保存在你选择的普通共享文件夹，可以用手机“我的文件”访问，不需要 root。'}
      </p>
      <p>
        {ios
          ? '请选择“我的 iPhone”中的本机文件夹；也可明确使用下面的本机归档位置。'
          : '建议在 Download 或 Documents 中新建“COC跑团记录簿”子文件夹，也可选择存储卡上的专用文件夹。'}
      </p>
      {props.label !== '尚未选择' && (
        <SystemMessage kind="warning" message={'原位置“' + props.label + '”当前不可读写，请重新确认。'} />
      )}
      <button className="primary" disabled={props.busy} onClick={props.onChoose}>
        {props.busy ? '正在确认…' : '选择并确认保存位置'}
      </button>
      {ios && props.onChooseLocal && (
        <>
          <button disabled={props.busy} onClick={props.onChooseLocal}>
            使用本机归档文件夹
          </button>
          <p className="muted">
            保存到“我的 iPhone → COC 跑团记录簿 → 归档”。卸载应用会删除该位置，重要备份请另存。
          </p>
        </>
      )}
      <p className="muted">取消不会配置成功。内部数据库由应用管理；卸载前请导出完整备份。</p>
    </section>
  )
}
