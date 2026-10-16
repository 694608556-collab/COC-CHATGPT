import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Use an installed JDK and a caller-supplied org.json JAR; no downloads or device access.
if (!process.env.JAVA_HOME || !process.env.JSON_JAR) throw new Error('Set JAVA_HOME and JSON_JAR (org.json).')
const work = await mkdtemp(join(tmpdir(), 'coc-native-metadata-'))
const sample = await build({
  stdin: {
    contents: `import { searchSample } from './src/dev/sample';
import { createEmptyCharacter } from '../src/shared/coc-rules';
const data = searchSample();
const character = createEmptyCharacter({edition:7,name:'公开角色',moduleId:data.modules[0].id});
character.weapons = [{name:'公开武器',damage:'1D6',range:10}];
character.background['自定义,背景'] = '保留全文';
data.characters = [character];
data.records[0].rawContent.messages[0].raw = {sentinel:'RAW_PRECISION',unicode:'中文😀\\"'};
console.log(JSON.stringify(data));`,
    resolveDir: process.cwd(),
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false
})
await writeFile(join(work, 'sample.mjs'), sample.outputFiles[0].contents)
const fixture = spawnSync(process.execPath, [join(work, 'sample.mjs')], { encoding: 'utf8' })
if (fixture.status) throw new Error(fixture.stderr)
// Raw JSON numeric precision and Unicode must survive native metadata operations exactly.
const json = fixture.stdout.replace('"RAW_PRECISION"', '900719925474099312345')
await writeFile(join(work, 'sample.json'), json)
const source = resolve('android/app/src/main/java/coc/logbook')
const sources = ['JsonFields', 'RecordOverlay', 'EntityEdits', 'LogbookActions', 'DocumentNames'].map(
  (name) => join(source, name + '.java')
)
const javac = join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac')
const java = join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
const compiled = spawnSync(
  javac,
  [
    '-encoding',
    'UTF-8',
    '-cp',
    process.env.JSON_JAR,
    '-d',
    work,
    ...sources,
    resolve('tests/native/MetadataCheck.java')
  ],
  { encoding: 'utf8' }
)
if (compiled.status) throw new Error(compiled.stderr)
const separator = process.platform === 'win32' ? ';' : ':'
const result = spawnSync(
  java,
  ['-cp', work + separator + process.env.JSON_JAR, 'coc.logbook.MetadataCheck', join(work, 'sample.json')],
  { encoding: 'utf8' }
)
process.stdout.write(result.stdout)
if (result.status) throw new Error(result.stderr)
const networkCompiled = spawnSync(
  javac,
  [
    '-encoding',
    'UTF-8',
    '-d',
    work,
    join(source, 'NetworkQueue.java'),
    resolve('tests/native/NetworkQueueCheck.java')
  ],
  { encoding: 'utf8' }
)
if (networkCompiled.status) throw new Error(networkCompiled.stderr)
const networkResult = spawnSync(java, ['-cp', work, 'coc.logbook.NetworkQueueCheck'], { encoding: 'utf8' })
process.stdout.write(networkResult.stdout)
if (networkResult.status) throw new Error(networkResult.stderr)
