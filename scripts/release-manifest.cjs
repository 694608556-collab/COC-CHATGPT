const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const dist = path.resolve(__dirname, '..', 'dist')
if (!fs.existsSync(dist)) throw new Error('dist directory does not exist')
const files = fs.readdirSync(dist).filter((name) => name.endsWith('.exe')).sort()
if (!files.length) throw new Error('no release executable found')
const lines = files.map((name) => {
  const bytes = fs.readFileSync(path.join(dist, name))
  const hash = createHash('sha256').update(bytes).digest('hex')
  return hash + '  ' + name
})
fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), lines.join('\n') + '\n', 'utf8')
console.log(lines.join('\n'))
