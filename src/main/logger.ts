import fs from 'node:fs'
import path from 'node:path'

const SENSITIVE_KEYS = /content|body|password|token|cookie|authorization|backup/i

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.test(key) ? '[已隐藏]' : sanitize(item)
    ])
  )
}

export class AppLogger {
  private readonly file: string

  constructor(
    private readonly directory: string,
    private readonly maxBytes = 2 * 1024 * 1024,
    private readonly files = 5
  ) {
    fs.mkdirSync(directory, { recursive: true })
    this.file = path.join(directory, 'app.log')
  }

  info(event: string, details: Record<string, unknown> = {}): void {
    this.write('INFO', event, details)
  }

  error(event: string, details: Record<string, unknown> = {}): void {
    this.write('ERROR', event, details)
  }

  private write(level: string, event: string, details: Record<string, unknown>): void {
    this.rotateIfNeeded()
    const line = JSON.stringify({ at: new Date().toISOString(), level, event, details: sanitize(details) })
    fs.appendFileSync(this.file, `${line}\n`, 'utf8')
  }

  private rotateIfNeeded(): void {
    if (!fs.existsSync(this.file) || fs.statSync(this.file).size < this.maxBytes) return
    for (let index = this.files - 1; index >= 1; index -= 1) {
      const source = index === 1 ? this.file : `${this.file}.${index - 1}`
      const target = `${this.file}.${index}`
      if (fs.existsSync(target)) fs.unlinkSync(target)
      if (fs.existsSync(source)) fs.renameSync(source, target)
    }
  }
}
