export type ImageInfo = { mime: string; width: number; height: number }

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// 模組環境沒有 Node 與 DOM，base64 要自己解
export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let held = 0
  let at = 0
  for (const char of clean) {
    bits = (bits << 6) | ALPHABET.indexOf(char)
    held += 6
    if (held >= 8) {
      held -= 8
      out[at++] = (bits >> held) & 0xff
      bits &= (1 << held) - 1
    }
  }
  return out
}

const be16 = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0)
const le16 = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8)
const le24 = (b: Uint8Array, i: number) => le16(b, i) | ((b[i + 2] ?? 0) << 16)
const be32 = (b: Uint8Array, i: number) => be16(b, i) * 65536 + be16(b, i + 2)
const int32 = (b: Uint8Array, i: number) => le16(b, i) | (le16(b, i + 2) << 16)
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))

function jpeg(b: Uint8Array): ImageInfo | null {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = b[i + 1] ?? 0
    if (marker === 0xff) {
      i += 1
      continue
    }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrame) return { mime: 'image/jpeg', height: be16(b, i + 5), width: be16(b, i + 7) }
    i += 2 + be16(b, i + 2)
  }
  return null
}

function webp(b: Uint8Array): ImageInfo | null {
  const mime = 'image/webp'
  const chunk = ascii(b, 12, 16)
  if (chunk === 'VP8 ') return { mime, width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff }
  if (chunk === 'VP8X') return { mime, width: le24(b, 24) + 1, height: le24(b, 27) + 1 }
  if (chunk === 'VP8L') {
    const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = b.subarray(21, 25)
    return { mime, width: (((b1 & 0x3f) << 8) | b0) + 1, height: (((b3 & 0x0f) << 10) | (b2 << 2) | (b1 >> 6)) + 1 }
  }
  return null
}

// 認得的格式回傳類型與尺寸；認不得或尺寸讀不到就回 null
export function sniff(b: Uint8Array): ImageInfo | null {
  let info: ImageInfo | null = null
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') info = { mime: 'image/png', width: be32(b, 16), height: be32(b, 20) }
  else if (b[0] === 0xff && b[1] === 0xd8) info = jpeg(b)
  else if (ascii(b, 0, 4) === 'GIF8') info = { mime: 'image/gif', width: le16(b, 6), height: le16(b, 8) }
  else if (ascii(b, 0, 2) === 'BM') info = { mime: 'image/bmp', width: int32(b, 18), height: Math.abs(int32(b, 22)) }
  else if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') info = webp(b)
  return info && info.width > 0 && info.height > 0 ? info : null
}
