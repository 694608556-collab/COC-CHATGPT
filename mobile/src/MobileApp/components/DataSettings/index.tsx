import type { ArchiveLocation } from '../../../data/native'
import type { MobileSnapshot } from '../../../data/types'

/**
 * 数据恢复/手动备份及目录管理入口；未完成能力明确列出。
 * @param props - 当前目录、数据统计、忙状态与真实操作事件。
 * @returns 手机设置页。
 */
export function DataSettings(props: {
  archive: ArchiveLocation
  snapshot: MobileSnapshot
  busy: boolean
  onChoose(): void
  onImport(): void
  onBackup(): void
}) {
  return (
    <>
      <section className="panel">
        <h2>归档位置</h2>
        <p className="location">{props.archive.label}</p>
        <p className="muted">已通过读写验证。若使用存储卡，拔卡后需重新确认位置。</p>
        <button disabled={props.busy} onClick={props.onChoose}>
          更改保存位置
        </button>
      </section>
      <section className="panel">
        <h2>备份与恢复</h2>
        <p>
          {props.snapshot.modules.length} 个模组 · {props.snapshot.records.length} 个场次 ·{' '}
          {props.snapshot.characters.length} 张角色卡
        </p>
        <button className="primary" disabled={props.busy} onClick={props.onImport}>
          选择备份并预览
        </button>
        <button disabled={props.busy} onClick={props.onBackup}>
          保存安卓备份
        </button>
        <p className="warning">
          安卓备份包含已保存正文，但当前电脑版尚未支持安全恢复此格式。请勿用旧电脑版整库恢复流程导入。
        </p>
        <p className="muted">
          卸载会删除应用内部数据库，卸载前请导出备份。导出的 TXT 文档不能替代完整数据备份。
        </p>
      </section>
      <section className="panel">
        <h2>开发阶段说明</h2>
        <p>已接入：目录确认、数据导入预览、安全覆盖、离线阅读、角色卡浏览、TXT 与手动备份。</p>
        <p className="muted">
          尚未接入：编辑、联网获取、自动备份、其他导出格式与分享操作。自动备份目前未运行，请手动备份。
        </p>
      </section>
    </>
  )
}
