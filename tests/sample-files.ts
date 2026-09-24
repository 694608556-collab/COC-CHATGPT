import fs from 'node:fs'
import path from 'node:path'

/**
 * 测试用的导图样例文件定位。
 *
 * 这些样例是用户的真实导图，体积大、不适合放进仓库，所以测试按绝对路径查找，
 * 找不到就自动跳过（skipIf）。两台开发机上的存放位置不同，所以每个样例给一组
 * 候选路径，谁在就用谁；都没有就跳过，不会误报失败。
 */

/** 样例的逻辑名 → 可能的绝对路径（按优先级排列） */
const CANDIDATES: Record<string, string[]> = {
  渊娲之海: [
    'F:\\1\\dist\\渊娲之海.emmx',
    'F:\\3-其他内容\\跑团\\2-渊娲之海\\渊娲之海.emmx',
    'E:\\COC模组\\渊娲之海.emmx'
  ],
  精神病院失踪事件: [
    'E:\\微信文件\\xwechat_files\\wxid_b70gzcimuk4h22_f95c\\msg\\file\\2025-07\\精神病院失踪事件.emmx',
    'F:\\3-其他内容\\跑团\\1-世界回归进行曲\\精神病院失踪事件.emmx'
  ],
  世界回归进行曲: [
    'E:\\微信文件\\xwechat_files\\wxid_b70gzcimuk4h22_f95c\\msg\\file\\2025-11\\世界回归进行曲.emmx',
    'F:\\3-其他内容\\跑团\\1-世界回归进行曲\\世界回归进行曲.emmx'
  ],
  龙台掠雪: ['E:\\COC模组\\龙台掠雪\\龙台掠雪.emmx'],
  月廻上: ['E:\\COC模组\\月廻\\月廻（上）.emmx'],
  月廻上时间线: ['E:\\COC模组\\月廻\\月廻（上）时间线.emmx'],
  锈蚀纪元: [
    'F:\\3-其他内容\\跑团\\其他\\锈蚀纪元的夜莺不再歌唱.emmx',
    'E:\\COC模组\\锈蚀纪元的夜莺不再歌唱.emmx'
  ],
  铸形骸html: [
    'F:\\1\\dist\\铸形骸，灯心性，启天命26907.html',
    // DSH 会话附件目录：处理用户上传文件时它会被复制到这里
    'C:\\Users\\Admin\\AppData\\Roaming\\dsh-launcher\\dsh-packs\\pack-test\\attachments\\v1\\files\\55\\559a075b75a21021c3daf0a938d806e02ca878d9a397377f7ba94ebdd6a77c01\\铸形骸，灯心性，启天命26907.html'
  ],
  铸形骸emmx: [
    'C:\\Users\\Admin\\AppData\\Roaming\\dsh-launcher\\dsh-packs\\pack-test\\attachments\\v1\\files\\96\\960f18ac72d50f303f8b26c6de6f1a1bcc0a6c19f1acbb8421a0083867bd9db4\\铸形骸，灯心性，启天命26907.emmx'
  ]
}

/** 返回第一个存在的候选路径；都没有则返回 undefined（调用方据此跳过） */
export function samplePath(name: keyof typeof CANDIDATES | string): string | undefined {
  const list = CANDIDATES[name]
  if (!list) return undefined
  return list.find((file) => fs.existsSync(file))
}

/** 该样例是否可用 */
export function hasSample(name: string): boolean {
  return samplePath(name) !== undefined
}

/** 取回全部可用的样例路径（用于遍历式测试） */
export function availableSamples(names: string[]): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = []
  for (const name of names) {
    const found = samplePath(name)
    if (found) out.push({ name, path: found })
  }
  return out
}

/** 项目根目录 */
export const projectRoot = path.resolve(__dirname, '..')
