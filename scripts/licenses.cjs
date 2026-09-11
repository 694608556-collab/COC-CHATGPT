const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const names = Object.keys(pkg.dependencies ?? {}).sort((a, b) => a.localeCompare(b))

function readPackage(name) {
  const packageFile = path.join(root, 'node_modules', name, 'package.json')
  if (!fs.existsSync(packageFile)) return { name, version: pkg.dependencies[name], license: 'UNKNOWN' }
  const data = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
  const license = typeof data.license === 'string' ? data.license : 'SEE PACKAGE'
  return { name, version: data.version ?? pkg.dependencies[name], license }
}

const rows = names.map(readPackage)
const lines = [
  '# Third Party Notices',
  '',
  'Generated from direct runtime dependencies in package.json.',
  '',
  '| Component | Version | License |',
  '| --- | --- | --- |',
  ...rows.map((item) => '| ' + item.name + ' | ' + item.version + ' | ' + item.license + ' |'),
  '',
  'Electron bundles Chromium and Node.js components; keep their upstream notices with release artifacts.',
  ''
]
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'), 'utf8')
