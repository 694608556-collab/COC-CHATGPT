import { encodeUtf8 } from './bytes'

/** Encode complete table text without a file-service round trip for ordinary
 * queued metadata. The crossover chooses an encoder; it never limits content.
 * @param text Complete candidate segment, including Unicode and original newlines.
 * @returns Standard UTF-8 for every input byte; larger inputs retain the full Blob path.
 */
export function encodeTableCandidate(text: string): Uint8Array<ArrayBuffer> {
  return text.length >= 1024 * 1024 ? encodeUtf8(text) : new TextEncoder().encode(text)
}
