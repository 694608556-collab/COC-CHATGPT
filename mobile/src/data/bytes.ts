/**
 * 顺序解码 Base64 文件，避免大文件逐字节映射回调开销。
 * @param value - 原生/文件读取边界返回的 Base64。
 * @returns 原始字节，不解释其中内容。
 */
export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * 分块编码文件，避免大数组展开超过实参数量限制。
 * @param bytes - 文本或二进制字节。
 * @returns 可通过原生桥传递的 Base64。
 */
export function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 16384)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 16384)))
  return btoa(chunks.join(''))
}

/**
 * 让浏览器原生文件读取器编码中等文件，避免界面逐字节构造二进制字符串。
 * @param bytes - 完整文件字节；不会修改调用方缓冲。
 * @returns 不含 data URL 前缀的 Base64；浏览器失败明确拒绝，Node 校验使用同一字节算法。
 */
export async function encodeFileBase64(bytes: Uint8Array): Promise<string> {
  if (typeof document === 'undefined') return encodeBase64(bytes)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string' || !result.startsWith('data:application/octet-stream;base64,')) {
        reject(new Error('文件编码失败，未保存。'))
        return
      }
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(new Error('文件编码失败，未保存。'))
    reader.onabort = () => reject(new Error('文件编码已取消，未保存。'))
    reader.readAsDataURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/octet-stream' }))
  })
}
