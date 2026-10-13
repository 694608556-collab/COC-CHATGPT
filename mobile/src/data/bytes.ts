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
