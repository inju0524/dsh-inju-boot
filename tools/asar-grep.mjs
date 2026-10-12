// Grep inside an Electron ASAR archive without extracting it.
// usage: node asar-grep.mjs <archive> <regex> [--ext .js] [--max 60]
import { readFileSync } from 'node:fs'

const [archive, pattern, ...rest] = process.argv.slice(2)
if (!archive || !pattern) {
  console.error('usage: asar-grep.mjs <archive> <regex> [--ext .js] [--max 60]')
  process.exit(2)
}
const flag = (name, fallback) => {
  const i = rest.indexOf(name)
  return i === -1 ? fallback : rest[i + 1]
}
const ext = flag('--ext', '')
const max = Number(flag('--max', 60))
const re = new RegExp(pattern)

const buf = readFileSync(archive)
const headerSize = buf.readUInt32LE(4)
const jsonLen = buf.readUInt32LE(12)
const header = JSON.parse(buf.toString('utf8', 16, 16 + jsonLen))
const baseOffset = 8 + headerSize

const files = []
;(function walk(node, prefix) {
  for (const [name, value] of Object.entries(node.files || {})) {
    const p = prefix ? `${prefix}/${name}` : name
    if (value.files) walk(value, p)
    else files.push({ path: p, offset: Number(value.offset), size: value.size, unpacked: value.unpacked })
  }
})(header, '')

let hits = 0
for (const file of files) {
  if (file.unpacked || file.size > 12 * 1024 * 1024) continue
  if (ext !== '' && !file.path.endsWith(ext)) continue
  const text = buf.subarray(baseOffset + file.offset, baseOffset + file.offset + file.size).toString('utf8')
  const lines = text.split('\n')
  let printed = 0
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue
    if (printed === 0) {
      console.log('\n=== ' + file.path + ' ===')
      hits++
    }
    if (printed < 4) console.log('  ' + (i + 1) + ': ' + lines[i].trim().slice(0, 220))
    printed++
  }
  if (hits >= max) break
}
console.log('\nmatched files: ' + hits)
