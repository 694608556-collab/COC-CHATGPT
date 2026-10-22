import type { StreamProof, StreamBackupMetadata } from './backup-stream'
import type { SavedDocument } from './native'

export interface NativeBackupFile extends StreamProof {
  fileUri: string
}
export interface NativeRestoreSource extends NativeBackupFile {
  id: string
  revision: number
  format: 'json' | 'zip'
  maximumStageBytes: number
}
export interface NativeBackupExport {
  id: string
  revision: number
  source: NativeBackupFile & { canonicalVersion: 1 }
  files: Array<NativeBackupFile & { name: string }>
  maximumBytes: number
}
export interface NativeRestoreAttachment extends StreamProof {
  zipPath: string
  name: string
  mime: string
}
export interface BackupStreamPort {
  appendBackupStage?(options: { id: string; key: string; index: number; base64: string }): Promise<void>
  finishBackupPreview?(options: {
    id: string
    candidate: StreamProof
    attachments: NativeRestoreAttachment[]
  }): Promise<{ id: string; revision: number; offlineRecords: number }>
  commitBackupRestore?(options: {
    id: string
    confirmed: boolean
    restoreSettings: boolean
  }): Promise<{ revision: number }>
  cancelBackupStage?(options: { id: string }): Promise<void>
  createBackupStream?(options: {
    expectedRevision: number
    includeArchives: boolean
  }): Promise<NativeBackupExport>
  finishBackupExport?(options: {
    id: string
    name: string
    proof?: StreamProof
  }): Promise<SavedDocument & { warning?: string }>
}
/** Bodyless display data and a native-owned confirmation lease, never a full
 * snapshot suitable for an ordinary overwrite. */
export interface LeasedBackupPreview {
  lease: string
  revision: number
  snapshot: StreamBackupMetadata
  offlineRecords: number
  warnings: string[]
}
