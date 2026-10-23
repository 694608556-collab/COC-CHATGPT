import fs from 'node:fs'
import path from 'node:path'
import { serialize } from 'node:v8'
import { validateBackupRecord } from '../src/data/backup'
import { exampleBackup } from '../src/data/fixtures'

// All inputs are invented here. The canonical production Zod schema decides
// acceptance; the native kernel must also validate discarded image/raw fields.
const directory = process.argv[2]
if (!directory) throw new Error('Public corpus output directory required')
const record = { ...exampleBackup().records[0]!, sourceType: 'manual' }
const message = {
  id: 'public-message', order: 1, timestamp: '2026-10-23T12:34:56Z',
  displayName: 'Reader 😀', platformAccount: 'public-account', text: '完整\nEND',
  type: 'message', isDiceCommand: false, isOffTopic: true,
  images: [{url: 'https://example.invalid/public.png', alt: 'public'}],
  raw: { fullUnknownTail: ['END', 9007199254740993, null] }
}
const seed = { parserVersion: 1, title: 'Public log', sourceUrl: 'https://example.invalid/public', responseHash: 'public-digest', messages: [message] }
const corpus: { name: string; input: string; expected: unknown }[] = []
/** Use canonical complete-body validation, preserving every primitive value. */
function add(name: string, input: string, strictInvalid = false): void {
  let expected: unknown = null
  try {
    const original = JSON.parse(input)
    const normalized = validateBackupRecord({ ...record, rawContent: original }).rawContent!
    if (!strictInvalid) expected = {
      ...original,
      messages: normalized.messages.map(item => [item.timestamp ?? null, item.displayName,
        item.platformAccount ?? null, item.text, item.isDiceCommand, item.isOffTopic, item.images.length > 0])
    }
  } catch { /* Invalid original content requires the full legacy rejection path. */ }
  corpus.push({ name, input, expected })
}
add('complete-original', JSON.stringify(seed))
const fields = ['parserVersion', 'title', 'sourceUrl', 'responseHash', 'messages', 'messages.0',
  ...Object.keys(message).map(key => 'messages.0.' + key), 'messages.0.images.0',
  'messages.0.images.0.url', 'messages.0.images.0.alt']
const values = [undefined, null, false, true, 0, -1.25, Number.MAX_VALUE, Number.MIN_VALUE, NaN, Infinity,
  '', 'public', '😀\ud800\nEND', [], {}, { url: '' }, [{ url: '', alt: '' }]]
for (const field of fields) for (let index = 0; index < values.length; index++) {
  const candidate: any = structuredClone(seed)
  const keys = field.split('.')
  let target = candidate
  for (const key of keys.slice(0, -1)) target = target[key]
  target[keys[keys.length - 1]!] = values[index]
  add(`${field}:${index}`, JSON.stringify(candidate))
}
for (const input of ['null', 'false', '0', '"public"', '[]', '{}']) add('root-' + input, input)
add('optional-fields-absent', JSON.stringify({parserVersion: 0, messages: [{...message, timestamp: undefined, platformAccount: undefined}]}))
add('empty-images', JSON.stringify({...seed, messages: [{...message, images: []}]}))
add('empty-messages', JSON.stringify({...seed, messages: []}))
add('multiple-messages', JSON.stringify({...seed, messages: [message, {...message, text: 'SECOND END', images: []}]}))
add('escaped-known-field-names', JSON.stringify(seed).replace('"parserVersion"', '"\\u0070arserVersion"').replace('"messages"', '"\\u006dessages"').replace('"text"', '"\\u0074ext"'))
add('unknown-wide-fields', JSON.stringify({...seed, unknown: Object.fromEntries(Array.from({length: 80}, (_, i) => ['key-' + i, i]))}))
add('unknown-arbitrary-precision', JSON.stringify(seed).replace('"public-digest"', '"public-digest","unknown":900719925474099312345,"more":1e999'))
for (const number of ['1e309', '-1e309', '1e-999', '-0', '1.7976931348623157e308', '1.7976931348623159e308']) {
  add('numeric-parser-' + number, JSON.stringify(seed).replace('"parserVersion":1', '"parserVersion":' + number))
  add('numeric-order-' + number, JSON.stringify(seed).replace('"order":1', '"order":' + number))
}
add('discarded-image-invalid-tail', JSON.stringify({...seed, messages: [{...message, images: [{url: 'public'}, {url: null}]}]}))
add('discarded-unknown-duplicate', JSON.stringify(seed).replace('"END",', '{"tail":1,"\\u0074ail":2},'), true)
add('discarded-unknown-surrogate-alias', JSON.stringify(seed).replace('"END",', '{"😀":1,"\\ud83d\\ude00":2},'), true)
add('duplicate-required-field', JSON.stringify(seed).replace('"order":1', '"order":1,"\\u006frder":2'), true)
add('duplicate-image-url', JSON.stringify(seed).replace('"url":', '"url":"public","\\u0075rl":'), true)
add('duplicate-log-field', JSON.stringify(seed).replace('"parserVersion":1', '"parserVersion":1,"\\u0070arserVersion":2'), true)
add('discarded-raw-truncated', JSON.stringify(seed).slice(0, -5))
// Deliberately force one 64-slot bucket, then cross the 32-key spill boundary.
// Distinct colliding keys must survive; exact/escaped duplicate keys must fail.
function bucket(key: string): number {
  let hash=1469598103934665603n
  for(let i=0;i<key.length;i++)hash=BigInt.asUintN(64,(hash^BigInt(key.charCodeAt(i)))*1099511628211n)
  return Number(hash&63n)
}
const colliding: string[]=[]
for(let number=0;colliding.length<40;number++){
  const key='collision-'+number
  if(bucket(key)===63)colliding.push(key)
}
for(const count of [2,16,31,32,33,40]){
  const members=colliding.slice(0,count).map(key=>JSON.stringify(key)+':true').join(',')
  const wrap=(extra: string)=>JSON.stringify(seed).replace('"public-digest"','"public-digest","unknown":{'+members+extra+'}')
  add('collision-chain-'+count,wrap(''))
  add('collision-exact-duplicate-'+count,wrap(','+JSON.stringify(colliding[count-1])+':false'),true)
  add('collision-escaped-duplicate-'+count,wrap(',"\\u0063'+colliding[count-1]!.slice(1)+'":false'),true)
}
for(const key of [...Object.keys(seed),...Object.keys(message),'url','alt']){
  const encoded='"\\u'+key.charCodeAt(0).toString(16).padStart(4,'0')+key.slice(1)+'"'
  add('escaped-field-'+key,JSON.stringify(seed).replace('"'+key+'"',encoded))
}
fs.writeFileSync(path.join(directory, 'public-corpus.jsonl'), corpus.map(item => item.input).join('\n') + '\n')
// V8 serialization preserves legal unknown JSON numbers that JSON.parse maps
// to Infinity; JSON.stringify would incorrectly replace those with null.
fs.writeFileSync(path.join(directory, 'public-corpus.expected.bin'), serialize(corpus.map(({ name, expected }) => ({ name, expected }))))
console.log(JSON.stringify({ publicDifferentialCases: corpus.length }))

// Exercise the exact full native body boundary too. The independent original
// schema still supplies every tuple; unrelated nested rawContent is retained.
const bodyPrefix = '{"unknown":{"rawContent":[1,2,{"END":"完整"}]},"manualContent":"完整\\uD800raw END","rawContent":'
const bodies = corpus.map(({ name, input, expected }) => ({
  name: 'body-' + name,
  input: bodyPrefix + input + '}',
  expected: expected === null ? null : {
    unknown: { rawContent: [1, 2, { END: '完整' }] },
    manualContent: '完整\uD800raw END', rawContent: expected
  }
}))
const outerCases: Array<[string, unknown]> = [
  ['{}', {}],
  ['{"manualContent":"full END"}', { manualContent: 'full END' }],
  ['{"unknown":{"rawContent":{}}}', { unknown: { rawContent: {} } }],
  ['null', null], ['[]', null], ['1', null],
  ['{"rawContent":null}', null], ['{"rawContent":[]}', null],
  ['{"rawContent":{"parserVersion":1,"messages":[]},"r\\u0061wContent":{}}', null],
  ['{"rawContent":{"parserVersion":1,"messages":[]},"tail":{"a":1,"\\u0061":2}}', null],
  ['{"rawContent":{"parserVersion":1,"messages":[{}]}}', null],
  ['{"manualContent":"END",}', null], ['{} false', null],
  ['{"rawContent":{"parserVersion":1,"messages":[],"unknown":{"x":1,"x":2}}}', null]
]
for (const [index, [input, expected]] of outerCases.entries())
  bodies.push({ name: 'outer-body-' + index, input, expected: expected as any })
fs.writeFileSync(path.join(directory, 'body-corpus.jsonl'), bodies.map(item => item.input).join('\n') + '\n')
fs.writeFileSync(path.join(directory, 'body-corpus.expected.bin'), serialize(bodies.map(({ name, expected }) => ({ name, expected }))))
