import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppLogger } from '../src/main/logger'
import { AppError, serializeError } from '../src/shared/errors'

describe('safe errors and logs', () => {
  it('does not expose unknown stack traces to the renderer', () => {
    expect(serializeError(new Error('C:\\secret\\file.txt'))).toEqual({
      code: 'UNKNOWN',
      category: 'UNKNOWN',
      message: '操作未完成，请稍后重试或查看日志。',
      retryable: false
    })
    expect(serializeError(new AppError('NETWORK_TIMEOUT', 'NETWORK', '连接超时', true)).retryable).toBe(true)
  })

  it('redacts content and credentials from rolling logs', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-logger-'))
    const logger = new AppLogger(directory, 80, 3)
    logger.info('fetch', { content: '完整团录', password: 'secret', recordId: 'r1' })
    logger.error('fetch', { token: 'abc', reason: 'timeout' })
    const combined = fs
      .readdirSync(directory)
      .map((name) => fs.readFileSync(path.join(directory, name), 'utf8'))
      .join('')
    expect(combined).not.toContain('完整团录')
    expect(combined).not.toContain('secret')
    expect(combined).not.toContain('abc')
    expect(combined).toContain('recordId')
  })
})
