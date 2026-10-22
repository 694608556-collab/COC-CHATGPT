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
const snapshotCompiled = spawnSync(javac, [
  '-encoding', 'UTF-8', '-d', work, join(source, 'SnapshotJson.java'), join(source, 'SnapshotStream.java'),
  resolve('tests/native/SnapshotStreamCheck.java')
], { encoding: 'utf8' })
if (snapshotCompiled.status !== 0) throw new Error(snapshotCompiled.stderr || String(snapshotCompiled.error))
const snapshotResult = spawnSync(java, ['-Xmx96m', '-cp', work, 'coc.logbook.SnapshotStreamCheck'], { encoding: 'utf8' })
process.stdout.write(snapshotResult.stdout)
if (snapshotResult.status !== 0) throw new Error(snapshotResult.stderr || String(snapshotResult.error))
const pickerCompiled = spawnSync(
  javac,
  [
    '-encoding',
    'UTF-8',
    '-d',
    work,
    resolve('android/app/src/androidTest/java/coc/logbook/PublicFolderAction.java'),
    resolve('tests/native/PublicFolderActionCheck.java')
  ],
  { encoding: 'utf8' }
)
if (pickerCompiled.status !== 0) throw new Error(pickerCompiled.stderr || String(pickerCompiled.error))
const pickerResult = spawnSync(java, ['-cp', work, 'coc.logbook.PublicFolderActionCheck'], {
  encoding: 'utf8'
})
process.stdout.write(pickerResult.stdout)
if (pickerResult.status !== 0) throw new Error(pickerResult.stderr || String(pickerResult.error))
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
const pdfCompiled = spawnSync(
  javac,
  [
    '-encoding',
    'UTF-8',
    '-d',
    work,
    join(source, 'LogbookLimits.java'),
    join(source, 'PdfSpool.java'),
    join(source, 'TextPdfJobs.java'),
    join(source, 'ReadLease.java'),
    join(source, 'StorageBudget.java'),
    resolve('tests/native/ReadLeaseCheck.java'),
    resolve('tests/native/TextPdfJobsCheck.java'),
    resolve('tests/native/PdfSpoolCheck.java')
  ],
  { encoding: 'utf8' }
)
if (pdfCompiled.status) throw new Error(pdfCompiled.stderr)
const pdfResult = spawnSync(java, ['-cp', work, 'coc.logbook.PdfSpoolCheck'], { encoding: 'utf8' })
process.stdout.write(pdfResult.stdout)
if (pdfResult.status) throw new Error(pdfResult.stderr)
const textPdfResult = spawnSync(java, ['-cp', work, 'coc.logbook.TextPdfJobsCheck'], { encoding: 'utf8' })
process.stdout.write(textPdfResult.stdout)
if (textPdfResult.status) throw new Error(textPdfResult.stderr)
const readLeaseResult = spawnSync(java, ['-cp', work, 'coc.logbook.ReadLeaseCheck'], { encoding: 'utf8' })
process.stdout.write(readLeaseResult.stdout)
if (readLeaseResult.status) throw new Error(readLeaseResult.stderr)
const publicationCompiled = spawnSync(
  javac,
  [
    '-encoding',
    'UTF-8',
    '-cp',
    process.env.JSON_JAR,
    '-d',
    work,
    join(source, 'LogbookLimits.java'),
    join(source, 'PdfSpool.java'),
    join(source, 'ArchivePublication.java'),
    join(source, 'StorageBudget.java'),
    resolve('tests/native/ArchivePublicationCheck.java')
  ],
  { encoding: 'utf8' }
)
if (publicationCompiled.status) throw new Error(publicationCompiled.stderr)
const publicationResult = spawnSync(
  java,
  ['-cp', work + separator + process.env.JSON_JAR, 'coc.logbook.ArchivePublicationCheck'],
  { encoding: 'utf8' }
)
process.stdout.write(publicationResult.stdout)
if (publicationResult.status) throw new Error(publicationResult.stderr)

const uploadCompiled = spawnSync(
  javac,
  [
    '-encoding',
    'UTF-8',
    '-d',
    work,
    join(source, 'LogbookLimits.java'),
    join(source, 'PdfSpool.java'),
    join(source, 'SnapshotUpload.java'),
    join(source, 'StorageBudget.java'),
    resolve('tests/native/SnapshotUploadCheck.java')
  ],
  { encoding: 'utf8' }
)
if (uploadCompiled.status) throw new Error(uploadCompiled.stderr)
const uploadResult = spawnSync(java, ['-cp', work, 'coc.logbook.SnapshotUploadCheck'], { encoding: 'utf8' })
process.stdout.write(uploadResult.stdout)
if (uploadResult.status) throw new Error(uploadResult.stderr)

const backupSources = [
  'AutomaticRetention',
  'StorageBudget',
  'BackupValidation',
  'StrictBackupJson',
  'RestoreCandidate',
  'BackupSession',
  'SnapshotBackupStream',
  'RawJson',
  'LogbookLimits',
  'JsonFields'
]
const backupCompiled = spawnSync(
  javac,
  [
    '-encoding',
    'UTF-8',
    '-cp',
    process.env.JSON_JAR,
    '-d',
    work,
    ...backupSources.map((name) => join(source, name + '.java')),
    resolve('tests/native/StorageBudgetCheck.java'),
    resolve('tests/native/SingleRecordCapacityCheck.java'),
    resolve('tests/native/StrictJsonPerformanceCheck.java'),
    resolve('tests/native/BackupStreamCheck.java')
  ],
  { encoding: 'utf8' }
)
if (backupCompiled.status) throw new Error(backupCompiled.stderr)
for (const name of ['StorageBudgetCheck', 'BackupStreamCheck', 'StrictJsonPerformanceCheck']) {
  const checked = spawnSync(
    java,
    [
      '-Xmx96m',
      '-cp',
      work + separator + process.env.JSON_JAR,
      'coc.logbook.' + name,
      join(work, 'sample.json'),
      process.env.COC_NATIVE_BACKUP_SCALE ?? '96'
    ],
    { encoding: 'utf8' }
  )
  process.stdout.write(checked.stdout)
  if (checked.status) throw new Error(checked.stderr)
}
const singleRecord = spawnSync(java, [
  '-Xmx1024m', '-cp', work + separator + process.env.JSON_JAR,
  'coc.logbook.SingleRecordCapacityCheck', join(work, 'sample.json')
], { encoding: 'utf8' })
process.stdout.write(singleRecord.stdout)
if (singleRecord.status) throw new Error(singleRecord.stderr)
const grammarCompiled = spawnSync(javac, [
  '-encoding', 'UTF-8', '-cp', work + separator + process.env.JSON_JAR, '-d', work,
  resolve('tests/native/SnapshotStreamGrammarCheck.java')
], { encoding: 'utf8' })
if (grammarCompiled.status !== 0) throw new Error(grammarCompiled.stderr || String(grammarCompiled.error))
const grammarResult = spawnSync(java, ['-Xmx96m', '-cp', work + separator + process.env.JSON_JAR, 'coc.logbook.SnapshotStreamGrammarCheck'], { encoding: 'utf8' })
process.stdout.write(grammarResult.stdout)
if (grammarResult.status !== 0) throw new Error(grammarResult.stderr || String(grammarResult.error))
