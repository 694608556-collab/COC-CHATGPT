import fs from 'node:fs'
import path from 'node:path'
import { isPathInside, nextAvailableName, sanitizeWindowsName } from '../shared/safe-path'

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
    fs.mkdirSync(directory, { recursive: true })
    const existing = fs.readdirSync(directory)
    const extension = path.extname(requestedName)
    const safeName = sanitizeWindowsName(requestedName.slice(0, -extension.length)) + extension
    const destination = path.join(directory, nextAvailableName(existing, safeName))
    if (!isPathInside(directory, destination)) throw new Error('归档文件路径不安全')
    return destination
  }

  availableRootFile(requestedName: string): string {
    const root = path.resolve(this.rootProvider())
    fs.mkdirSync(root, { recursive: true })
    const extension = path.extname(requestedName)
    const safeName = sanitizeWindowsName(requestedName.slice(0, -extension.length)) + extension
    const destination = path.join(root, nextAvailableName(fs.readdirSync(root), safeName))
    if (!isPathInside(root, destination)) throw new Error('归档文件路径不安全')
    return destination
  }
}
