import { runWorkerJob } from './worker-channel'
import type { PdfPngImage } from './pdf-png'

/** @param png One complete native canvas PNG; ownership transfers to the existing export Worker.
 * @returns Lossless page RGB stream. UI code never decodes/recompresses pixels synchronously.
 */
export async function pdfPngInBackground(png: Uint8Array): Promise<PdfPngImage> {
  if (typeof document === 'undefined') return (await import('./pdf-png')).pdfImageFromPng(png)
  return runWorkerJob('export', { type: 'pdf-png', png }, [png.buffer as ArrayBuffer])
}
