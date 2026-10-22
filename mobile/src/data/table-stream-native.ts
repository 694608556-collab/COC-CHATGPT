import type { NativeBackupFile } from './backup-stream-native'
import type { StreamProof } from './backup-stream'

export interface NativeTableSource extends NativeBackupFile {
  id: string
  revision: number
  name: string
  format: 'csv' | 'xlsx' | 'xls'
  maximumStageBytes: number
}
export interface NativeTablePreview {
  id: string
  revision: number
  added: number
  updated: number
  skipped: number
  namesCount: number
  warningsCount: number
  names: string[]
  warnings: string[]
}
export interface TableStreamPort {
  appendTableStage?(options: {
    id: string
    key: 'candidate' | 'strings'
    index: number
    base64: string
  }): Promise<void>
  readTableString?(options: {
    id: string
    stringIndex: number
    offset: number
  }): Promise<{ base64: string; bytes: number; done: boolean }>
  finishTablePreview?(options: { id: string; candidate: StreamProof }): Promise<NativeTablePreview>
  readTablePreview?(options: {
    id: string
    kind: 'names' | 'warnings'
    offset: number
    limit: number
  }): Promise<{ values: string[]; total: number }>
  commitTableStream?(options: {
    id: string
    confirmed: true
  }): Promise<{ revision: number; warning?: string }>
  cancelTableStage?(options: { id: string }): Promise<void>
}
