import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '../shared/errors'
import { isPathInside } from '../shared/safe-path'
import type { NoteImage } from '../shared/types'

const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

export class NoteFileService {
  constructor(private readonly dataDirectory: string) {}

  directory(): string {
    const target = path.join(this.dataDirectory, 'notes')
    fs.mkdirSync(target, { recursive: true })
    return target
  }

  saveFromPath(sourcePath: string): NoteImage {
    return this.save(fs.readFileSync(sourcePath), path.basename(sourcePath))
  }

  saveFromBytes(bytes: Uint8Array, originalName: string): NoteImage {
    return this.save(Buffer.from(bytes), originalName)
  }

  absolutePath(relative: string): string {
    const candidate = path.resolve(this.dataDirectory, relative)
    if (!isPathInside(this.dataDirectory, candidate)) {
      throw new AppError('NOTE_IMAGE_PATH', 'FILE', '图片路径不安全。')
    }
    return candidate
  }

  remove(images: NoteImage[]): void {
    for (const image of images) {
      try {
        const target = this.absolutePath(image.path)
        if (fs.existsSync(target)) fs.unlinkSync(target)
      } catch {
        // ignore missing or unsafe entries
      }
    }
  }

  private save(bytes: Buffer, originalName: string): NoteImage {
    if (!bytes.length) throw new AppError('NOTE_IMAGE_EMPTY', 'FILE', '图片内容为空。')
    const rawExtension = path.extname(originalName).toLowerCase()
    const extension = ALLOWED.has(rawExtension) ? rawExtension : '.png'
    const fileName = `${randomUUID()}${extension}`
    fs.writeFileSync(path.join(this.directory(), fileName), bytes)
    return { path: `notes/${fileName}`, name: path.basename(originalName) || fileName }
  }
}
