import { expect, it } from 'vitest'
import { StreamJson } from './stream-json'
import { createHash } from 'node:crypto'

async function read(text: string, size: number) {
  const bytes = new TextEncoder().encode(text)
  const chunks = async function* () { for (let at=0;at<bytes.length;at+=size) yield bytes.subarray(at,at+size) }
  const reader = new StreamJson(chunks(),bytes.length,bytes.length)
  const result = await reader.readRawValue()
  expect(await reader.finish()).toEqual({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})
  expect(result.json).toBe(text)
  return result.value
}
it('escaped syntax inside strings cannot become a key or delimiter across any UTF-8 boundary', async () => {
  const value={body:'😀 " } ] : , \\ \n \\" key: ',first:{same:1},second:{same:2},tail:[true,false,null,-1.25e7,'完整尾']}
  const json=JSON.stringify(value)
  for(const size of [1,2,3,7,17,65536]) expect(await read(json,size)).toEqual(value)
})
it('all original and escaped key aliases reject duplicates at every object depth and chunk boundary', async () => {
  for(const name of ['text','__proto__','constructor','未知😀']) {
    const encoded=JSON.stringify(name), alias='"'+Array.from(name).map(char=>char.length===2?char:'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0')).join('')+'"'
    for(const size of [1,7,65536]) for(const json of ['{'+encoded+':1,'+alias+':2}','[{"nested":{'+encoded+':false,'+alias+':null}}]'])
      await expect(read(json,size)).rejects.toThrow('重复')
  }
})
it('millions of escaped characters retain the entire body without a regex stack or content-size failure', async () => {
  const value={body:'\\\n"😀'.repeat(400000),tail:'PUBLIC_COMPLETE_END'}
  expect(await read(JSON.stringify(value),65536)).toEqual(value)
})
