import type { ExportSource } from './export-source'

/**
 * 从本地服务器直接读取原生的不可变文件，并在后台核对大小和摘要。
 * @param source - 原生生成或已登记且由界面映射的只读凭证。
 * @param attachment - 是否为已登记 content 附件；否则必须为私有正文文件。
 * @returns 完整原始字节；任何截断、变动、非本地地址均拒绝，不回写文件。
 */
export async function readSource(
  source: Pick<ExportSource, 'url' | 'bytes' | 'sha256'>,
  attachment = false
): Promise<Uint8Array> {
  const url = new URL(source.url)
  const current = new URL(location.href)
  if (
    url.protocol !== current.protocol || url.hostname !== current.hostname || url.port !== current.port || url.username || url.password ||
    !url.pathname.startsWith(attachment ? '/_capacitor_content_/' : '/_capacitor_file_/')
  )
    throw new Error('只允许读取本应用的本地导出正文。')
  if (!Number.isSafeInteger(source.bytes) || source.bytes < (attachment ? 0 : 1))
    throw new Error('导出正文大小无效。')
  const response = await fetch(url.href, { cache: 'no-store', redirect: 'error' })
  if (!response.ok) throw new Error('读取完整导出正文失败。')
  const bytes = new Uint8Array(await response.arrayBuffer())
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
  if (bytes.length !== source.bytes || hash !== source.sha256)
    throw new Error('导出正文回读校验失败，未创建文件。')
  return bytes
}
