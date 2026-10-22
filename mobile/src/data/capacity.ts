/** Transport window only. File, record, request and collection sizes use the
 * operation's actual storage budget and runtime allocation capacity. */
export const capacity = {
  transferChunkBytes: 256 * 1024
} as const
