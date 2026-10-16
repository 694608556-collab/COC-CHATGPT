import path from 'node:path'

export { sanitizeExportName as sanitizeWindowsName } from './export-filenames'

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
