// 用系統真正的縮圖工具跑 register.tsx 裡的腳本：Windows 走 PowerShell，macOS 走 sips，Linux 走 ImageMagick
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

import { decodeBase64, sniff } from '../hooks/image.ts'

const LIMIT = 130000
const source = readFileSync(new URL('../hooks/register.tsx', import.meta.url), 'utf8')
const script = name => source.match(new RegExp(`const ${name} = String\\.raw\`([\\s\\S]*?)\``))[1]

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data])
  const size = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([size, body, crc])
}

// 隨機像素的 PNG 壓不下去，一定會超過上限
function noisePng(width, height) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2], 8)
  const row = width * 3 + 1
  const pixels = randomBytes(row * height)
  for (let y = 0; y < height; y++) pixels[y * row] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) throw new Error(`${command} exit ${result.status}: ${result.stderr}`)
  return result.stdout.trim()
}

function check(label, base64, { mime, maxSide }) {
  const info = sniff(decodeBase64(base64))
  if (!info) throw new Error(`${label}: output is not a recognised image`)
  if (mime && info.mime !== mime) throw new Error(`${label}: expected ${mime}, got ${info.mime}`)
  if (maxSide && Math.max(info.width, info.height) > maxSide) {
    throw new Error(`${label}: ${info.width}x${info.height} is larger than ${maxSide}`)
  }
  console.log(`ok ${label}: ${info.mime} ${info.width}x${info.height}, ${base64.length} base64 chars`)
  return info
}

// 路徑刻意含空格與中文
const dir = mkdtempSync(join(tmpdir(), 'image-pane-'))
const path = join(dir, '測試 image.png')
writeFileSync(path, noisePng(1600, 1000))

try {
  if (process.platform === 'win32') {
    const base64 = run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script('ENCODE_WINDOWS')],
      { IMAGE_PANE_PATH: path, IMAGE_PANE_LIMIT: String(LIMIT) },
    )
    if (base64.length > LIMIT) throw new Error(`output is over the limit: ${base64.length}`)
    check('powershell shrink', base64, { maxSide: 1600 })
  } else {
    const resize = (size, format, quality) =>
      run('sh', ['-c', script('RESIZE_SH'), 'sh', path, String(size), format, String(quality)])
    check('png 320', resize(320, 'png', 0), { mime: 'image/png', maxSide: 320 })
    check('jpeg 320', resize(320, 'jpeg', 82), { mime: 'image/jpeg', maxSide: 320 })
    const fits = resize(320, 'jpeg', 60)
    if (fits.length > LIMIT) throw new Error(`320px jpeg is over the limit: ${fits.length}`)
    check('jpeg 320 q60', fits, { mime: 'image/jpeg', maxSide: 320 })
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
