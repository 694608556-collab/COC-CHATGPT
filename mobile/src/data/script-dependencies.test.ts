import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const temporaryRoot = resolve(tmpdir())
let work: string
let mobile: string

beforeAll(() => {
  work = mkdtempSync(join(temporaryRoot, 'coc-mobile-dependencies-'))
  mobile = join(work, 'mobile')
  mkdirSync(join(mobile, 'scripts'), { recursive: true })
  // Reproduce a fresh CI checkout with dependencies installed only in mobile.
  // Copy the actual parser and fixtures so this exercises both real bundlers.
  for (const name of ['src', 'tests', 'test-fixtures'])
    cpSync(resolve(name), join(mobile, name), { recursive: true })
  cpSync(resolve('../src/shared'), join(work, 'src/shared'), { recursive: true })
  for (const name of ['check-table-kernel.mjs', 'public-io-fixtures.mjs'])
    cpSync(resolve('scripts', name), join(mobile, 'scripts', name))
  symlinkSync(
    resolve('node_modules'),
    join(mobile, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir'
  )
  expect(existsSync(join(work, 'node_modules'))).toBe(false)
})

afterAll(() => {
  if (!work) return
  if (
    dirname(resolve(work)) !== temporaryRoot ||
    !basename(work).startsWith('coc-mobile-dependencies-') ||
    !lstatSync(work).isDirectory() ||
    lstatSync(work).isSymbolicLink()
  )
    throw new Error('Refusing to remove an unexpected dependency-test path')
  rmSync(work, { recursive: true, force: true })
})

function run(name: string, args: string[] = []) {
  const env = { ...process.env }
  delete env.NODE_PATH
  const result = spawnSync(process.execPath, [join(mobile, 'scripts', name), ...args], {
    cwd: mobile,
    env,
    encoding: 'utf8',
    timeout: 60_000
  })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(existsSync(join(work, 'node_modules'))).toBe(false)
  return result.stdout
}

it('runs the complete kernel baseline with only mobile dependencies', () => {
  const output = run('check-table-kernel.mjs')
  const results = output
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line))
  expect(results).toHaveLength(2)
  expect(results[0]).toMatchObject({ cases: 33, passed: true, nativeDifferential: false })
  expect(results[1]).toMatchObject({ recordsCases: 38, passed: true, nativeDifferential: false })
}, 60_000)

it.each([false, true])(
  'builds complete public I/O fixtures with only mobile dependencies (ios=%s)',
  (ios) => {
    run('public-io-fixtures.mjs', ios ? ['--ios'] : [])
    const assets = join(mobile, ios ? 'ios/build/public-io' : 'android/app/src/androidTest/assets')
    expect(JSON.parse(readFileSync(join(assets, 'public-io-kernel-manifest.json'), 'utf8'))).toHaveLength(33)
    expect(
      JSON.parse(readFileSync(join(assets, 'public-io-record-kernel-manifest.json'), 'utf8'))
    ).toHaveLength(38)
    expect(readFileSync(join(assets, 'public-io-webview.js')).length).toBeGreaterThan(0)
    if (ios)
      expect(Object.keys(JSON.parse(readFileSync(join(assets, 'inputs.json'), 'utf8')))).toHaveLength(6)
  },
  60_000
)
