export type ErrorCategory =
  | 'DATA'
  | 'NETWORK'
  | 'PARSE'
  | 'FILE'
  | 'CONVERSION'
  | 'BACKUP'
  | 'IMPORT'
  | 'VALIDATION'
  | 'UNKNOWN'

export interface SerializedAppError {
  code: string
  category: ErrorCategory
  message: string
  retryable: boolean
}

export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly category: ErrorCategory,
    message: string,
    readonly retryable = false,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function serializeError(error: unknown): SerializedAppError {
  if (error instanceof AppError) {
    return { code: error.code, category: error.category, message: error.message, retryable: error.retryable }
  }
  return {
    code: 'UNKNOWN',
    category: 'UNKNOWN',
    message: '操作未完成，请稍后重试或查看日志。',
    retryable: false
  }
}
