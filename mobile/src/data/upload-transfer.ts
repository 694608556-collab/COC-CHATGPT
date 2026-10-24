import { zlibSync } from 'fflate'
import { capacity } from './capacity'

/** 已编码的桥接分段；原生必须独立核对展开长度和完整候选摘要。 */
export interface UploadWireChunk {
  /** 只允许原始字节或独立 zlib 流。 */
  encoding: 'identity' | 'zlib'
  /** 此段完整展开字节数；不表示整场正文总量。 */
  rawBytes: number
  /** 至多 256KiB 传输字节的 Base64，不包含其他租约数据。 */
  base64: string
}

/** 只在后台会话保留的无损传输段；既不代表保存，也不持有原生权限。 */
export interface UploadTransferChunk {
  /** 编码方式；不可压缩的内容保留原始字节。 */
  encoding: 'identity' | 'zlib'
  /** 解压后的精确字节数，最多 2MiB 的临时窗口，不限制正文总量。 */
  rawBytes: number
  /** 传输字节，最多沿用 256KiB 的桥接窗口。 */
  bytes: Uint8Array
}

/** 对完整候选按独立窗口无损打包，不截断不可压缩内容。
 * @param bytes - 已校验、编码并计算完整 SHA256 的全部候选字节。
 * @returns 按原顺序排列的传输段；不可压缩窗口回退成原有大小的原始分段。
 */
export function packUploadBytes(bytes: Uint8Array): UploadTransferChunk[] {
  const result: UploadTransferChunk[] = []
  const windowBytes = 2 * 1024 * 1024
  for (let offset = 0; offset < bytes.length; offset += windowBytes) {
    const original = bytes.subarray(offset, offset + windowBytes)
    // 小型临时匹配表减少旧 WebView 的分配和缓存开销；不可压缩内容仍完整回退。
    const compressed = zlibSync(original, { level: 1, mem: 2 })
    if (compressed.length <= capacity.transferChunkBytes && compressed.length < original.length) {
      result.push({ encoding: 'zlib', rawBytes: original.length, bytes: compressed })
    } else {
      for (let at = 0; at < original.length; at += capacity.transferChunkBytes) {
        const part = original.subarray(at, at + capacity.transferChunkBytes)
        result.push({ encoding: 'identity', rawBytes: part.length, bytes: part })
      }
    }
  }
  return result
}
