/** Independent bounded request/file budgets. Whole-library storage and complete
 * backup/restore use native available-volume budgets; these remain unchanged.
 */
export const capacity = {
  snapshotRequestBytes: 64 * 1024 * 1024,
  snapshotUploadBytes: 64 * 1024 * 1024,
  tableRequestBytes: 64 * 1024 * 1024,
  backupInputBytes: 64 * 1024 * 1024,
  backupFileBytes: 64 * 1024 * 1024,
  archiveFileBytes: 64 * 1024 * 1024,
  readSourceBytes: 64 * 1024 * 1024,
  recordResponseBytes: 64 * 1024 * 1024,
  zipExpandedBytes: 128 * 1024 * 1024,
  attachmentTotalBytes: 128 * 1024 * 1024,
  zipEntries: 2000,
  archiveAttachments: 1999,
  transferChunkBytes: 256 * 1024
} as const
