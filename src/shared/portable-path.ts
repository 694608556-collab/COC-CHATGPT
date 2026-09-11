import path from 'node:path'

export interface PortablePathEnvironment {
  portableExecutableDir?: string
  executablePath: string
  developmentRoot?: string
}

export function resolvePortableRoot(environment: PortablePathEnvironment): string {
  if (environment.portableExecutableDir?.trim()) {
    return path.resolve(environment.portableExecutableDir)
  }
  if (environment.developmentRoot?.trim()) {
    return path.resolve(environment.developmentRoot)
  }
  return path.dirname(path.resolve(environment.executablePath))
}

export function resolveDataDirectory(environment: PortablePathEnvironment): string {
  return path.join(resolvePortableRoot(environment), 'data')
}
