import { useLayoutEffect, useState } from 'react'

export const DISPLAY_SIZES = [
  { value: 0.9, label: '小' },
  { value: 1, label: '标准' },
  { value: 1.15, label: '大' },
  { value: 1.3, label: '特大' }
] as const
const storageKey = 'coc-display-size-v1'

/** @returns 本设备上已保存且受支持的字号比例，读取失败时使用标准字号。 */
function savedSize(): number {
  try {
    const value = Number(localStorage.getItem(storageKey))
    return DISPLAY_SIZES.some((size) => size.value === value) ? value : 1
  } catch {
    return 1
  }
}

/** @returns 字号、保存错误及选择操作。仅保存本设备显示偏好，无业务数据写入。 */
export function useDisplaySize() {
  const [size, setSize] = useState(savedSize)
  const [error, setError] = useState('')
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--display-scale', String(size))
  }, [size])
  /** @param value 受支持的字号比例。 @returns 无返回值，持久化成功后更新界面。 */
  function chooseSize(value: number): void {
    if (!DISPLAY_SIZES.some((item) => item.value === value)) return
    try {
      localStorage.setItem(storageKey, String(value))
      setSize(value)
      setError('')
    } catch {
      setError('字号保存失败，请重试。')
    }
  }
  return { size, error, chooseSize }
}
