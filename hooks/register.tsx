import type { EngineInterface, Register } from 'claude-code'

import { decodeBase64, sniff } from './image'

const PANE = 'image-pane'
const TOOL_NAME = 'show_image'
const TOOL = 'mcp__image-pane__show_image'
const SEND_FILE = 'SendUserFile'
const IMAGE_FILE = /\.(png|jpe?g|gif|bmp|webp|svg)$/i
// Svg 的 source 上限是 131072 字元，預留外層標籤的空間
const SVG_LIMIT = 131072
const BASE64_LIMIT = 130000
const SIZES = [1920, 1600, 1280, 1024, 800, 640, 480, 320, 240, 160]
const QUALITIES: ReadonlyArray<readonly [string, number]> = [
  ['png', 0],
  ['jpeg', 82],
  ['jpeg', 60],
]
const MISSING_TOOL = 127

type Shown = { path: string; caption: string; svg: string; width: number; height: number }

// Windows 用內建的 System.Drawing 縮圖，路徑走環境變數，不拼進指令
const ENCODE_WINDOWS = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
$limit = [int]$env:IMAGE_PANE_LIMIT
$raw = [IO.File]::ReadAllBytes([IO.Path]::GetFullPath($env:IMAGE_PANE_PATH))
$stream = New-Object IO.MemoryStream(,$raw)
$img = [Drawing.Image]::FromStream($stream)
$w = $img.Width; $h = $img.Height
$jpeg = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
function Render($tw, $th, $white) {
  $bmp = New-Object Drawing.Bitmap $tw, $th
  $g = [Drawing.Graphics]::FromImage($bmp)
  if ($white) { $g.Clear([Drawing.Color]::White) }
  $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, 0, 0, $tw, $th)
  $g.Dispose()
  return $bmp
}
foreach ($max in 1920, 1600, 1280, 1024, 800, 640, 480, 320, 240, 160) {
  $scale = [Math]::Min(1.0, $max / [Math]::Max($w, $h))
  $tw = [Math]::Max(1, [int]($w * $scale)); $th = [Math]::Max(1, [int]($h * $scale))
  $bmp = Render $tw $th $false
  $out = New-Object IO.MemoryStream
  $bmp.Save($out, [Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $b64 = [Convert]::ToBase64String($out.ToArray())
  if ($b64.Length -le $limit) { Write-Output $b64; exit 0 }
  $bmp = Render $tw $th $true
  foreach ($q in 82, 60) {
    $params = New-Object Drawing.Imaging.EncoderParameters(1)
    $params.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality, [long]$q)
    $out = New-Object IO.MemoryStream
    $bmp.Save($out, $jpeg, $params)
    $b64 = [Convert]::ToBase64String($out.ToArray())
    if ($b64.Length -le $limit) { Write-Output $b64; exit 0 }
  }
  $bmp.Dispose()
}
throw 'image too large to fit'
`

// macOS 內建 sips，其他系統用 ImageMagick；參數一律走位置引數，不拼進指令
const RESIZE_SH = String.raw`
in=$1; max=$2; fmt=$3; q=$4
if command -v sips >/dev/null 2>&1; then
  dir=$(mktemp -d) || exit 1
  if [ "$fmt" = jpeg ]; then set -- -s format jpeg -s formatOptions "$q"; else set -- -s format png; fi
  sips -Z "$max" "$@" "$in" --out "$dir/out" >/dev/null || { rm -rf "$dir"; exit 1; }
  base64 < "$dir/out" | tr -d '\n'
  rm -rf "$dir"
  exit 0
fi
if command -v magick >/dev/null 2>&1; then tool=magick
elif command -v convert >/dev/null 2>&1; then tool=convert
else echo 'no image tool' >&2; exit 127
fi
if [ "$fmt" = jpeg ]; then
  "$tool" "$in[0]" -background white -flatten -resize "$max"x"$max>" -quality "$q" jpeg:- | base64 | tr -d '\n'
else
  "$tool" "$in[0]" -resize "$max"x"$max>" png:- | base64 | tr -d '\n'
fi
`

// 用 VS Code 分頁開原圖；code 是 .cmd，路徑含 cmd 特殊字元時改交給系統預設程式，避免被 cmd 解析
const OPEN_WINDOWS = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$p = [IO.Path]::GetFullPath($env:IMAGE_PANE_PATH)
if ((Get-Command code -ErrorAction SilentlyContinue) -and $p -notmatch '[&|<>^%"]') { & code --reuse-window $p; exit $LASTEXITCODE }
Start-Process -FilePath $p
`

const OPEN_SH = String.raw`
if command -v code >/dev/null 2>&1; then exec code --reuse-window "$1"
elif command -v open >/dev/null 2>&1; then exec open "$1"
elif command -v xdg-open >/dev/null 2>&1; then exec xdg-open "$1"
else echo 'no program to open the file' >&2; exit 127
fi
`

const powershell = (script: string) =>
  ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function isWindows($: EngineInterface) {
  return (await $.env.get('OS')) === 'Windows_NT'
}

// 只有成功載入過的圖片才會畫出按鈕，所以路徑一定是圖片檔
async function openOriginal($: EngineInterface, path: string) {
  try {
    const { exitCode, stderr } = (await isWindows($))
      ? await $.process.run(powershell(OPEN_WINDOWS), { env: { IMAGE_PANE_PATH: path }, timeoutMs: 30000 })
      : await $.process.run(['sh', '-c', OPEN_SH, 'sh', path], { timeoutMs: 30000 })
    if (exitCode !== 0) $.ui.toast(`無法開啟原圖：${stderr.trim().slice(0, 200)}`)
  } catch (err) {
    $.ui.toast(`無法開啟原圖：${messageOf(err)}`)
  }
}

async function shrinkWindows($: EngineInterface, path: string) {
  const { exitCode, stdout, stderr } = await $.process.run(powershell(ENCODE_WINDOWS), {
    env: { IMAGE_PANE_PATH: path, IMAGE_PANE_LIMIT: String(BASE64_LIMIT) },
    timeoutMs: 60000,
  })
  if (exitCode !== 0) throw new Error(stderr.trim().slice(0, 400) || `PowerShell 結束碼 ${exitCode}`)
  return stdout.trim()
}

async function shrinkUnix($: EngineInterface, path: string, longest: number | undefined) {
  const sizes = longest ? [longest, ...SIZES.filter(size => size < longest)] : SIZES
  for (const size of sizes) {
    for (const [format, quality] of QUALITIES) {
      const { exitCode, stdout, stderr } = await $.process.run(
        ['sh', '-c', RESIZE_SH, 'sh', path, String(size), format, String(quality)],
        { timeoutMs: 60000 },
      )
      if (exitCode === MISSING_TOOL) throw new Error('圖片太大要先縮小，但找不到縮圖工具，請安裝 ImageMagick')
      const base64 = stdout.trim()
      if (exitCode !== 0 || !base64) throw new Error(stderr.trim().slice(0, 400) || `縮圖失敗，結束碼 ${exitCode}`)
      if (base64.length <= BASE64_LIMIT) return base64
    }
  }
  throw new Error('圖片縮到最小仍超過上限')
}

function embed(path: string, caption: string, base64: string): Shown | null {
  const info = sniff(decodeBase64(base64))
  if (!info) return null
  const { mime, width, height } = info
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<image width="${width}" height="${height}" href="data:${mime};base64,${base64}"/></svg>`
  return { path, caption, svg, width, height }
}

async function load($: EngineInterface, path: string, caption: string): Promise<Shown> {
  if (!(await $.fs.exists(path))) throw new Error('找不到檔案')
  if (/\.svg$/i.test(path)) {
    const text = await $.fs.read(path)
    const start = text.indexOf('<svg')
    if (start < 0) throw new Error('不是有效的 SVG 檔')
    const svg = text.slice(start)
    if (svg.length > SVG_LIMIT) throw new Error(`SVG 有 ${svg.length} 字元，超過上限 ${SVG_LIMIT}`)
    return { path, caption, svg, width: 0, height: 0 }
  }
  // 放得下就原檔嵌入，不需要任何外部工具；$.fs.read 超過 4 MiB 會拒絕，那種就直接交給縮圖工具
  let original: string | undefined
  try {
    original = (await $.fs.read(path, { as: 'bytes' })).base64
  } catch {
    original = undefined
  }
  if (original && original.length <= BASE64_LIMIT) {
    const shown = embed(path, caption, original)
    if (shown) return shown
  }
  const head = original ? sniff(decodeBase64(original.slice(0, 400000))) : null
  const longest = head ? Math.max(head.width, head.height) : undefined
  const base64 = (await isWindows($)) ? await shrinkWindows($, path) : await shrinkUnix($, path, longest)
  const shown = embed(path, caption, base64)
  if (!shown) throw new Error('縮圖工具的輸出不是可辨識的圖片')
  return shown
}

function readInput(input: unknown) {
  const { path, caption, files } = (input ?? {}) as { path?: unknown; caption?: unknown; files?: unknown }
  return {
    path: typeof path === 'string' ? path : '',
    caption: typeof caption === 'string' ? caption : '',
    files: Array.isArray(files) ? files.filter((file): file is string => typeof file === 'string') : [],
  }
}

// 依工具呼叫與路徑記下要畫的圖；重開對話後從當時的路徑重新載入，失敗就記 null 不再重試
const loaded = new Map<string, Promise<Shown | null>>()
let latest: Shown | undefined

function loadOnce($: EngineInterface, id: string, path: string, caption: string) {
  const key = `${id}:${path}`
  let pending = loaded.get(key)
  if (!pending) {
    pending = load($, path, caption).catch(() => null)
    loaded.set(key, pending)
  }
  return pending
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: TOOL_NAME,
      description:
        '只在本機顯示一張圖片（PNG、JPEG、GIF、BMP、WebP、SVG），畫在這次工具呼叫的位置，網頁版與手機收不到。有 SendUserFile 工具時請改用它，不要用這個：它傳的圖片也會畫在 VS Code 對話裡，網頁版與手機也收得到。只有沒有 SendUserFile（沒開遠端控制）時才用這個工具。VS Code 面板看不到 Markdown 圖片。圖片只顯示給使用者，你不會收到圖片內容；要自己看圖請用 Read。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '圖片檔的路徑，絕對路徑或相對於工作目錄' },
          caption: { type: 'string', description: '圖片說明，可省略' },
        },
        required: ['path'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'img',
      description: '在面板顯示一張本機圖片：/img <路徑>',
      argumentHint: '<路徑>',
    })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const { path, caption } = readInput(e)
    if (!path) return { deny: '缺少 path' }
    try {
      const shown = await load($, path, caption)
      loaded.set(`${e.tool_use_id}:${path}`, Promise.resolve(shown))
      $.ui.invalidate('ui.render')
      const size = shown.width ? `，面板顯示尺寸 ${shown.width}x${shown.height}` : ''
      return { result: `已在本機顯示 ${path}${size}` }
    } catch (err) {
      return { deny: `無法顯示 ${path}：${messageOf(err)}` }
    }
  })

  // 指令沒有工具列可以畫，改開面板；面板窄時會蓋住對話，所以只有這裡才開
  on('command.run', { command: 'img' }, async ($, e) => {
    const path = e.args.trim().replace(/^"(.*)"$/, '$1')
    if (!path) {
      await $.ui.open({ id: PANE, title: '圖片', closeOnEscape: true })
      return { text: latest ? `目前顯示：${latest.path}` : '用法：/img <路徑>' }
    }
    try {
      latest = await load($, path, '')
      await $.ui.open({ id: PANE, title: '圖片', closeOnEscape: true })
      $.ui.invalidate('ui.render')
      return { text: `已顯示 ${path}` }
    } catch (err) {
      return { text: `無法顯示 ${path}：${messageOf(err)}` }
    }
  })

  // 終端機沒有 Svg，留原本的工具列；SendUserFile 只改 VS Code，桌面版有自己的預覽
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { tool, tool_use_id: id, input, isRunning, isErrored } = e.props
    if (e.surface === 'terminal' || isRunning || isErrored) return next(e)
    const { path, caption, files } = readInput(input)
    let paths: string[] = []
    if (tool === TOOL) paths = [path]
    else if (tool === SEND_FILE && e.surface === 'vscode') paths = files.filter(file => IMAGE_FILE.test(file))
    if (paths.length === 0) return next(e)
    const images = (await Promise.all(paths.map(file => loadOnce($, id, file, caption)))).filter(
      (image): image is Shown => image !== null,
    )
    if (images.length === 0) return next(e)
    const { Box, Button, Text, Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {caption !== '' && <Text dimColor>{caption}</Text>}
        {images.map(image => (
          <Box flexDirection="column" key={image.path}>
            <Svg source={image.svg} alt={caption || image.path} />
            <Button key={`open:${image.path}`} label="開啟原圖" onPress={() => void openOriginal($, image.path)} />
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface === 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>{latest ? `[圖片] ${latest.path}` : '還沒有圖片'}</Text>
    }
    const { Box, Button, Text, Svg } = $.ui.resolve(e)
    if (!latest) return <Text dimColor>還沒有圖片。用 /img 路徑 開一張。</Text>
    const { path, svg } = latest
    return (
      <Box flexDirection="column">
        <Text dimColor>{path}</Text>
        <Svg source={svg} alt={path} />
        <Button key="open" label="開啟原圖" onPress={() => void openOriginal($, path)} />
      </Box>
    )
  })
}
