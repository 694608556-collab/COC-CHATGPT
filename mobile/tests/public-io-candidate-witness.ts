import { decodeBase64 } from '../src/data/bytes'

/** Independent test evidence only; never used by a production import.
 * Capture immutable bridge strings without adding a second decode to the
 * measured application. Read every byte after the complete preview, alongside
 * the existing independent SHA/source/row oracle checks and before any pass.
 */
export class CandidateWitness {
  private readonly chunks: string[] = []
  private consumed = false
  /** @param base64 Complete original bridge segment. @returns No value. */
  append(base64: string) {
    if (this.consumed || typeof base64 !== 'string') throw Error('Candidate witness is invalid')
    this.chunks.push(base64)
  }
  /** @returns Every captured byte, in order; malformed or reused evidence fails. */
  read(): Uint8Array<ArrayBuffer> {
    if (this.consumed) throw Error('Candidate witness was already consumed')
    this.consumed = true
    try {
      const parts = this.chunks.map(decodeBase64)
      const length = parts.reduce((total, part) => total + part.length, 0)
      if (!Number.isSafeInteger(length)) throw Error('Candidate witness length is inexact')
      const complete = new Uint8Array(length)
      let offset = 0
      for (const part of parts) {
        complete.set(part, offset)
        offset += part.length
      }
      return complete
    } finally {
      this.chunks.length = 0
    }
  }
}
