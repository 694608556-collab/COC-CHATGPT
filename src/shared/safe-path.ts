import path from 'node:path'

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export function sanitizeWindowsName(value: string, fallback = '未命名'): string {
  let result = Array.from(value, (character) =>
    character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? '＿' : character
  )
    .join('')
    .replace(/[. ]+$/g, '')
    .trim()
  if (!result) result = fallback
  if (WINDOWS_RESERVED.test(result)) result = `_${result}`
  return result.slice(0, 120).replace(/[. ]+$/g, '') || fallback
}

export function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

export function nextAvailableName(existingNames: Iterable<string>, requested: string): string {
  const used = new Set(Array.from(existingNames, (name) => name.toLocaleLowerCase()))
  if (!used.has(requested.toLocaleLowerCase())) return requested
  const extension = path.extname(requested)
  const stem = requested.slice(0, requested.length - extension.length)
  let index = 2
  while (used.has(`${stem} (${index})${extension}`.toLocaleLowerCase())) index += 1
  return `${stem} (${index})${extension}`
}
