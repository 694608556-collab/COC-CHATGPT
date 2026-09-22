import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '../shared/errors'
import { isPathInside, nextAvailableName, sanitizeWindowsName } from '../shared/safe-path'

/**
 * 确保归档目录真的可写。
 *
 * 0.6.3 之前这里直接 mkdirSync，一旦设置里的路径指向不存在的用户目录
 * （例如换过 Windows 账户后残留的 C:\Users\Administrator），只会抛出裸 EPERM。
 * 而 serializeError 对非 AppError 一律显示“操作未完成，请稍后重试或查看日志”，
 * 用户完全看不出是归档目录的问题。所以这里统一抛 AppError，把真实路径和原因带出去。
 */
export function ensureWritableDirectory(directory: string): void {
  try {
    fs.mkdirSync(directory, { recursive: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    throw new AppError(
      'ARCHIVE_DIRECTORY_UNAVAILABLE',
      'FILE',
      `归档目录无法创建：${directory}${code ? `（${code}）` : ''}。请到“数据与设置”里重新选择归档位置。`,
      false,
      error
    )
  }
  // 目录已存在时 mkdirSync 不会报错，但仍可能不可写，所以要实际探测一次
  const probe = path.join(directory, `.coc-write-test-${process.pid}`)
  try {
    fs.writeFileSync(probe, '')
    fs.unlinkSync(probe)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    throw new AppError(
      'ARCHIVE_DIRECTORY_UNWRITABLE',
      'FILE',
      `归档目录不可写：${directory}${code ? `（${code}）` : ''}。请到“数据与设置”里重新选择归档位置。`,
      false,
      error
    )
  }
}

/** 只检查不创建，供设置页显示目录状态。 */
export function inspectArchiveDirectory(directory: string): { ok: boolean; reason?: string } {
  try {
    fs.mkdirSync(directory, { recursive: true })
  } catch (error) {
    return { ok: false, reason: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' }
  }
  const probe = path.join(directory, `.coc-write-test-${process.pid}`)
  try {
    fs.writeFileSync(probe, '')
    fs.unlinkSync(probe)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' }
  }
}

export class ArchivePathService {
  constructor(private readonly rootProvider: () => string) {}

  moduleDirectory(moduleName: string): string {
    const root = path.resolve(this.rootProvider())
    const directory = path.join(root, sanitizeWindowsName(moduleName, '未命名模组'))
    if (!isPathInside(root, directory)) throw new Error('归档目录不安全')
    return directory
  }

  availableFile(moduleName: string, requestedName: string): string {
    const directory = this.moduleDirectory(moduleName)
    ensureWritableDirectory(directory)
    const existing = fs.readdirSync(directory)
    const extension = path.extname(requestedName)
    const safeName = sanitizeWindowsName(requestedName.slice(0, -extension.length)) + extension
    const destination = path.join(directory, nextAvailableName(existing, safeName))
    if (!isPathInside(directory, destination)) throw new Error('归档文件路径不安全')
    return destination
  }

  batchFile(moduleName: string, requestedName: string): string {
    const root = path.resolve(this.rootProvider())
    const batchRoot = path.join(root, '批量合成')
    const directory = path.join(batchRoot, sanitizeWindowsName(moduleName, '未命名模组'))
    if (!isPathInside(root, directory)) {
      throw new Error('归档目录不安全')
    }
    ensureWritableDirectory(directory)
    const extension = path.extname(requestedName)
    const safeName = sanitizeWindowsName(requestedName.slice(0, -extension.length)) + extension
    const destination = path.join(directory, nextAvailableName(fs.readdirSync(directory), safeName))
    if (!isPathInside(directory, destination)) {
      throw new Error('归档文件路径不安全')
    }
    return destination
  }
  availableRootFile(requestedName: string): string {
    const root = path.resolve(this.rootProvider())
    ensureWritableDirectory(root)
    const extension = path.extname(requestedName)
    const safeName = sanitizeWindowsName(requestedName.slice(0, -extension.length)) + extension
    const destination = path.join(root, nextAvailableName(fs.readdirSync(root), safeName))
    if (!isPathInside(root, destination)) throw new Error('归档文件路径不安全')
    return destination
  }
}
