import type { MobileSnapshot } from './types'

/**
 * 仅有未备份修改时安排自动备份；idle 旧值现在代表十分钟周期。
 * @param snapshot - 最新已提交快照，时间来自保存确认。
 * @param lastBackup - 上次成功备份时间，毫秒；首次使用数据修改时间作为起点。
 * @param now - 当前时间，毫秒。
 * @param revision - 当前已提交版本；与备份版本共同提供时精确判断修改。
 * @param backedRevision - 已成功备份的版本；期间新提交不标记已备份。
 * @returns 距离到期的毫秒数；关闭或无修改为 undefined，不因回前台重置周期。
 */
export function automaticBackupDelay(
  snapshot: MobileSnapshot,
  lastBackup: number | undefined,
  now: number,
  revision?: number,
  backedRevision?: number
) {
  const config = snapshot.settings.autoBackup
  if (!config?.enabled) return undefined
  const modified = Date.parse(snapshot.exportedAt)
  if (!Number.isFinite(modified)) return undefined
  if (revision !== undefined && backedRevision !== undefined) {
    if (revision === backedRevision) return undefined
  } else if (lastBackup && lastBackup >= modified) return undefined
  const interval = config.interval === 'idle' ? 600000 : config.interval === 'daily' ? 86400000 : 604800000
  return Math.max(0, (lastBackup || modified) + interval - now)
}
