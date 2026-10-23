/** Independently undo all five PNG row filters for the complete RGB page.
 * @param filtered Inflated PDF predictor rows, including one filter byte per row.
 * @param width Complete canvas width in pixels.
 * @param height Complete canvas height in pixels.
 * @returns All RGB pixels in filter-zero rows, for byte equality and whole-page SHA proofs.
 */
export function rgbReferenceRows(filtered: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 3
  if (filtered.length !== (stride + 1) * height) throw Error('Incomplete reference page')
  const output = new Uint8Array(filtered.length)
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1)
    const filter = filtered[start]!
    if (filter > 4) throw Error('Invalid reference filter')
    for (let x = 0; x < stride; x++) {
      const destination = start + 1 + x
      const left = x >= 3 ? output[destination - 3]! : 0
      const above = y ? output[destination - stride - 1]! : 0
      const corner = y && x >= 3 ? output[destination - stride - 4]! : 0
      let prediction = 0
      switch (filter) {
        case 1:
          prediction = left
          break
        case 2:
          prediction = above
          break
        case 3:
          prediction = Math.floor((left + above) / 2)
          break
        case 4: {
          const estimate = left + above - corner
          const candidates = [left, above, corner]
          const distances = candidates.map((value) => Math.abs(estimate - value))
          prediction = candidates[distances.indexOf(Math.min(...distances))]!
        }
      }
      output[destination] = (filtered[destination]! + prediction) & 255
    }
  }
  return output
}
