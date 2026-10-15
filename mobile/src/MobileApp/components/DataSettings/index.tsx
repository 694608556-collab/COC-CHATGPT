import type { ArchiveLocation } from '../../../data/native'
import type { SavedDocument } from '../../../data/native'
import type { MobileSnapshot } from '../../../data/types'
import { SystemMessage } from '../SystemMessage'
import { SelectField } from '../SelectField'
import type { SettingsPatch } from '../../../data/settings-batch'

/**
 * 数据恢复/手动备份及目录管理入口；未完成能力明确列出。
 * @param props - 当前目录、数据统计、忙状态与真实操作事件。
 * @returns 手机设置页。
 */
export function DataSettings(props: {
  savedBodyCount: number
  archive: ArchiveLocation
  snapshot: MobileSnapshot
  busy: boolean
  settingsDisabled: boolean
  saveStatus: string
  canRetry: boolean
  onRetry(): void
  backingUp: boolean
  onChoose(): void
  onImport(): void
  onBackup(): void
  onZipBackup(): void
  onTheme(theme: 'light' | 'dark'): void
  onSettings(settings: SettingsPatch): void
  onAutoBackup(): void
  lastAutoBackupAt?: number
  onClear(): void
  onTableExport(format: 'csv' | 'xlsx'): void
  onTableImport(): void
  documents: SavedDocument[]
  onListDocuments(): void
  onOpenDocument(uri: string): void
  onShareDocument(uri: string): void
}) {
  return (
    <>
      <section aria-label="数据统计" className="summary">
        <strong>
          {props.snapshot.modules.length}
          <small>模组</small>
        </strong>
        <strong>
          {props.snapshot.records.length}
          <small>场次</small>
        </strong>
        <strong>
          {props.savedBodyCount}
          <small>已保存正文</small>
        </strong>
        <strong>
          {props.snapshot.characters.length}
          <small>角色卡</small>
        </strong>
      </section>
      <section className="panel">
        <div className="settings-section-heading">
          <h2>阅读与导出默认设置</h2>
          <span
            className="settings-save-status"
            role={props.saveStatus ? 'status' : undefined}
            aria-label="设置保存状态"
          >
            {props.saveStatus}
          </span>
        </div>
        {props.canRetry && (
          <button disabled={props.busy} onClick={props.onRetry}>
            重试保存设置
          </button>
        )}
        <div className="settings-option-grid">
          {Object.entries({
            hideDiceCommands: '隐藏骰指令',
            hideImages: '隐藏图片链接',
            hideOffTopic: '隐藏题外话',
            hideTime: '隐藏时间',
            hidePlatformAccount: '隐藏平台账号',
            hideYearMonthDay: '隐藏年月日'
          }).map(([key, label]) => (
            <label className="check" key={key}>
              <input
                disabled={props.settingsDisabled}
                type="checkbox"
                checked={
                  props.snapshot.settings.filterPreset[
                    key as keyof typeof props.snapshot.settings.filterPreset
                  ]
                }
                onChange={(e) =>
                  props.onSettings({
                    filterPreset: { [key]: e.target.checked }
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>显示主题</h2>
        <div className="edit-actions" role="group" aria-label="显示主题">
          <button
            disabled={props.settingsDisabled}
            aria-pressed={props.snapshot.settings.theme === 'light'}
            onClick={() => props.onTheme('light')}
          >
            浅色模式
          </button>
          <button
            disabled={props.settingsDisabled}
            aria-pressed={props.snapshot.settings.theme === 'dark'}
            onClick={() => props.onTheme('dark')}
          >
            深色模式
          </button>
        </div>
        <p className="muted">保存后下次打开仍使用所选主题。</p>
      </section>
      <section className="panel">
        <h2>自动本地备份</h2>
        <p className="muted">
          编辑、设置、排序、删除和导入直接保存最新数据，不额外生成操作前副本。 启用自动备份后，默认至少间隔 10
          分钟且有修改才备份；已有副本保留。
        </p>
        <label className="check">
          <input
            disabled={props.settingsDisabled}
            type="checkbox"
            checked={props.snapshot.settings.autoBackup?.enabled ?? false}
            onChange={(e) =>
              props.onSettings({
                autoBackup: {
                  enabled: e.target.checked
                }
              })
            }
          />
          启用自动备份
        </label>
        <SelectField
          label="自动备份周期"
          disabled={props.settingsDisabled}
          value={props.snapshot.settings.autoBackup?.interval ?? 'idle'}
          onChange={(value) =>
            props.onSettings({
              autoBackup: {
                interval: value as 'idle' | 'daily' | 'weekly'
              }
            })
          }
          options={[
            { value: 'idle', label: '每 10 分钟（有修改时）' },
            { value: 'daily', label: '每日' },
            { value: 'weekly', label: '每周' }
          ]}
        />
        <p className="muted">
          应用运行期间执行；关闭或系统暂停期间不保证定时执行，下次启动检查到期时间。只轮换本应用登记的自动备份，保留最近
          10 份；手动/安全副本不删除。
        </p>
        <p>
          {props.lastAutoBackupAt
            ? '上次成功：' + new Date(props.lastAutoBackupAt).toLocaleString()
            : '尚未生成自动备份'}
        </p>
        <button disabled={props.busy || props.backingUp} onClick={props.onAutoBackup}>
          {props.backingUp ? '自动备份中…' : '立即生成自动备份'}
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
        <button disabled={props.busy} onClick={props.onZipBackup}>
          保存含归档 ZIP 备份
        </button>
        <SystemMessage
          kind="warning"
          message="安卓备份包含已保存正文，但当前电脑版尚未支持安全恢复此格式。请勿用旧电脑版整库恢复流程导入。"
        />
        <p className="muted">
          卸载会删除应用内部数据库，卸载前请导出备份。导出的 TXT 文档不能替代完整数据备份。
        </p>
      </section>
      <section className="panel">
        <h2>表格导入与导出</h2>
        <button disabled={props.busy} onClick={props.onTableImport}>
          导入场次表格
        </button>
        <button
          disabled={props.busy || !props.snapshot.records.length}
          onClick={() => props.onTableExport('csv')}
        >
          导出记录 CSV
        </button>
        <button
          disabled={props.busy || !props.snapshot.records.length}
          onClick={() => props.onTableExport('xlsx')}
        >
          导出记录 Excel
        </button>
      </section>

      <section className="panel">
        <h2>归档位置</h2>
        <p className="location">{props.archive.label}</p>
        <p className="muted">已通过读写验证。若使用存储卡，拔卡后需重新确认位置。</p>
        <button disabled={props.busy} onClick={props.onChoose}>
          更改保存位置
        </button>
      </section>

      <section className="panel">
        <h2>归档文件</h2>
        <button disabled={props.busy} onClick={props.onListDocuments}>
          刷新归档文件
        </button>
        <p className="muted">
          显示本应用登记的最近 30 份导出、迁移附件和备份。文件被移动、修改或删除后，打开/分享会明确报错。
        </p>
        {props.documents.map((file) => (
          <section className="pair-editor" key={file.uri}>
            <p className="source-link">
              {file.name} · {file.bytes} 字节
            </p>
            <button disabled={props.busy} onClick={() => props.onOpenDocument(file.uri)}>
              打开 {file.name}
            </button>
            <button disabled={props.busy} onClick={() => props.onShareDocument(file.uri)}>
              分享 {file.name}
            </button>
          </section>
        ))}
      </section>
      <section className="panel">
        <h2>清空应用数据</h2>
        <p>清空模组、场次和角色卡，保留设置及归档文件。不会生成操作前副本，需要时请先手动备份。</p>
        <button disabled={props.busy} className="danger" onClick={props.onClear}>
          清空应用数据
        </button>
      </section>
      <section className="panel">
        <h2>开发阶段说明</h2>
        <p>
          已接入：模组/场次/角色编辑、删除与关联管理，日志获取、离线阅读与搜索，表格导入导出、批量/合成日志导出、明暗主题与自动本地备份、归档打开/分享。
        </p>
        <p className="muted">
          安卓原生目录、网络、分享、返回键和升级保留数据仍需真机验收。浏览器可测试数据与页面逻辑。
        </p>
      </section>

      <section className="panel" aria-label="版本说明">
        <h2>版本说明</h2>
        <p>0.2.16-dev · 启动试验</p>
        <p>数据仅本机保存、无账户</p>
        <p>仅海豹链接相关联网</p>
        <p>应用制作：亦如长风万里沙</p>
      </section>
    </>
  )
}
