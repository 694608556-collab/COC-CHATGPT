import { expect, it } from 'vitest'
import { exampleBackup } from './fixtures'
import { validateBackupRecord } from './backup'
import { validateReadOnlySearchRecord } from './search-record-validation'
import { recordMessages } from './search'
import { DEFAULT_FILTER_PRESET } from '../../../src/shared/types'

it('borrowed search validation agrees with the complete backup schema for every body field and source association', () => {
  const first = exampleBackup().records[0]!
  const seed = {...first, rawContent: {...first.rawContent, title:'title',sourceUrl:first.link,responseHash:'digest',messages:[{...first.rawContent.messages[0]!,timestamp:'2026-10-23T10:00:00Z',platformAccount:'public',raw:{unknown:['full',9007199254740993]},images:[{url:'https://example.com/a.png',alt:'public'}]}]}}
  const paths = ['rawContent','rawContent.title','rawContent.sourceUrl','rawContent.responseHash','rawContent.parserVersion','rawContent.messages',
    ...['id','order','timestamp','displayName','platformAccount','text','type','isDiceCommand','isOffTopic','images','raw'].map(k=>'rawContent.messages.0.'+k),
    'rawContent.messages.0.images.0','rawContent.messages.0.images.0.url','rawContent.messages.0.images.0.alt','cacheSourceUrl','link']
  for (const path of paths) for (const value of [undefined,null,false,1,NaN,Infinity,'',[],{},'https://example.invalid/other']) {
    const candidate: any = structuredClone(seed), keys=path.split('.');let target=candidate
    for(const key of keys.slice(0,-1)) target=target[key]
    target[keys.at(-1)!]=value
    let canonical: ReturnType<typeof validateBackupRecord> | undefined
    try { canonical=validateBackupRecord(candidate) } catch {}
    if (!canonical) expect(()=>validateReadOnlySearchRecord(candidate),path).toThrow()
    else expect(recordMessages(validateReadOnlySearchRecord(candidate),DEFAULT_FILTER_PRESET),path).toEqual(recordMessages(canonical,DEFAULT_FILTER_PRESET))
  }
})
