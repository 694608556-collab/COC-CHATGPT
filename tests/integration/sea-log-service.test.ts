import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { AppRepository } from '../../src/main/repository'
import { SeaLogService, type FetchLike } from '../../src/main/sea-log-service'

let database: AppDatabase
let repository: AppRepository
let directory: string

function response(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'https://dice-api.weizaima.com/dice/api/load_data',
    json: async () => payload
  } as unknown as Response
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-sea-'))
  database = new AppDatabase(path.join(directory, 'coc.sqlite'))
  database.initialize()
  repository = new AppRepository(database, path.join(directory, 'archive'))
})

afterEach(() => database.close())

describe('SeaLogService', () => {
  it('fetches, parses, caches and protects a manual date', async () => {
    const module = repository.createModule({ name: '模组', playStatus: 'not_started' })
    const record = repository.createRecord({
      moduleId: module.id,
      link: 'https://log.weizaima.com/?key=valid',
      playDate: '2024-01-02'
    })
    const fetcher: FetchLike = async () =>
      response(200, { messages: [{ nickname: 'KP', time: '2025-03-08 19:30', content: '开始' }] })
    const service = new SeaLogService(repository, path.join(directory, 'cache'), fetcher)
    const result = await service.probe(record.id)
    expect(result).toMatchObject({ status: 'valid', playDate: '2024-01-02', dateSource: 'manual' })
    expect(service.readValidCache(record.id)?.messages[0]?.text).toBe('开始')
  })

  it('distinguishes invalid links from transient failures', async () => {
    const module = repository.createModule({ name: '模组', playStatus: 'not_started' })
    const invalid = repository.createRecord({
      moduleId: module.id,
      link: 'https://log.weizaima.com/?key=missing'
    })
    const unavailable = repository.createRecord({
      moduleId: module.id,
      link: 'https://log.weizaima.com/?key=busy'
    })
    expect(
      (
        await new SeaLogService(repository, path.join(directory, 'cache'), async () =>
          response(404, null)
        ).probe(invalid.id)
      ).status
    ).toBe('invalid')
    const failed = await new SeaLogService(repository, path.join(directory, 'cache'), async () =>
      response(503, null)
    ).probe(unavailable.id)
    expect(failed.status).toBe('fetch_failed')
    expect(failed.previousStatus).toBe('pending')
  })

  it('inflates current SealDice compressed payloads', async () => {
    const module = repository.createModule({ name: 'module', playStatus: 'not_started' })
    const record = repository.createRecord({
      moduleId: module.id,
      link: 'https://log.weizaima.com/?key=packed'
    })
    const packed = zlib.deflateSync(
      Buffer.from(
        JSON.stringify({
          items: [{ nickname: 'KP', time: 1788692891, message: 'start' }]
        })
      )
    )
    const payload = { data: packed.toString('base64'), name: 'packed-log' }
    const service = new SeaLogService(repository, path.join(directory, 'cache'), async () =>
      response(200, payload)
    )
    const result = await service.probe(record.id)
    expect(result.status).toBe('valid')
    expect(result.rawContent?.messages[0]?.text).toBe('start')
  })
  it('accepts net fetch responses without a final url', async () => {
    const module = repository.createModule({ name: 'module', playStatus: 'not_started' })
    const record = repository.createRecord({
      moduleId: module.id,
      link: 'https://log.weizaima.com/?key=electron'
    })
    const service = new SeaLogService(
      repository,
      path.join(directory, 'cache'),
      async () =>
        ({
          ok: true,
          status: 200,
          url: '',
          json: async () => ({ messages: [{ content: 'ok' }] })
        }) as Response
    )
    const result = await service.probe(record.id)
    expect(result.status).toBe('valid')
  })
  it('keeps successful content after a network failure and isolates it after URL changes', async () => {
    const module = repository.createModule({ name: '模组', playStatus: 'not_started' })
    const record = repository.createRecord({
      moduleId: module.id,
      link: 'https://log.weizaima.com/?key=one'
    })
    const success = new SeaLogService(repository, path.join(directory, 'cache'), async () =>
      response(200, { messages: [{ content: '缓存正文' }] })
    )
    await success.probe(record.id)
    const failure = new SeaLogService(repository, path.join(directory, 'cache'), async () => {
      throw new Error('offline')
    })
    const failed = await failure.probe(record.id)
    expect(failed.status).toBe('fetch_failed')
    expect(failed.previousStatus).toBe('valid')
    expect(failed.rawContent?.messages[0]?.text).toBe('缓存正文')
    repository.updateRecord(record.id, { link: 'https://log.weizaima.com/?key=two' })
    expect(success.readValidCache(record.id)).toBeUndefined()
  })
})
