// Minimal Electron ASAR reader: list entries, and extract one file to stdout.
// Usage:
//   node asar-list.mjs <archive> [grep-substring]
//   node asar-list.mjs <archive> --cat <inner-path>
import { readFileSync, writeFileSync } from 'node:fs'

const [archive, a, b] = process.argv.slice(2)
if (!archive) {
  console.error('usage: asar-list.mjs <archive> [grep] | --cat <inner-path>')
  process.exit(2)
}
const buf = readFileSync(archive)

// ASAR: [uint32 size=4][uint32 headerSize][uint32 headerStringSize][uint32 jsonLen] + json
const headerSize = buf.readUInt32LE(4)
const headerStringSize = buf.readUInt32LE(8)
const jsonLen = buf.readUInt32LE(12)
const jsonStart = 16
const json = buf.toString('utf8', jsonStart, jsonStart + jsonLen)
const header = JSON.parse(json)
const baseOffset = 8 + headerSize

const files = []
function walk(node, prefix) {
  for (const [name, value] of Object.entries(node.files || {})) {
    const p = prefix ? `${prefix}/${name}` : name
    if (value.files) walk(value, p)
    else files.push({ path: p, offset: value.offset, size: value.size, unpacked: value.unpacked })
  }
}
walk(header, '')

if (a === '--cat') {
  const target = files.find((f) => f.path === b)
  if (!target) {
    console.error(`not found: ${b}`)
    process.exit(1)
  }
  const start = baseOffset + Number(target.offset)
  process.stdout.write(buf.subarray(start, start + target.size))
} else if (a) {
  const needle = a.toLowerCase()
  for (const f of files) if (f.path.toLowerCase().includes(needle)) console.log(f.size.toString().padStart(10), f.path)
} else {
  for (const f of files) console.log(f.size.toString().padStart(10), f.path)
}
