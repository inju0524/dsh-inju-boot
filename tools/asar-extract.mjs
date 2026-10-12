// Extract every ASAR entry whose path contains <substring> into <outDir>,
// preserving the path tail after the substring.
// usage: node asar-extract.mjs <archive> <substring> <outDir>
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const [archive, needleRaw, outDir] = process.argv.slice(2)
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

const needle = needleRaw.toLowerCase()
let count = 0
for (const f of files) {
  const idx = f.path.toLowerCase().indexOf(needle)
  if (idx === -1) continue
  if (f.unpacked) {
    console.log(`skip (unpacked): ${f.path}`)
    continue
  }
  const rel = f.path.slice(idx)
  const target = join(outDir, rel)
  mkdirSync(dirname(target), { recursive: true })
  const start = baseOffset + f.offset
  writeFileSync(target, buf.subarray(start, start + f.size))
  console.log(`${f.size.toString().padStart(8)}  ${rel}`)
  count++
}
console.log(`extracted ${count} files -> ${outDir}`)
