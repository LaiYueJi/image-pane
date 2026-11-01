import { expect, test } from 'claude-code/testing'

import { decodeBase64, sniff } from './image'

const TOOL = 'mcp__image-pane__show_image'
// 1x1 的 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const ran = (stdout: string, exitCode = 0, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})
const FILE_EXISTS = { value: true }
const TOO_BIG = PNG.slice(0, 40) + 'A'.repeat(140000)

const row = (id: string, surface: 'vscode' | 'terminal', extra: object = {}) =>
  ({
    plugin: 'image-pane',
    component: 'ToolUse',
    requestId: id,
    surface,
    props: {
      tool_use_id: id,
      tool: TOOL,
      input: { path: 'a.png', caption: '說明' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      ...extra,
    },
  }) as never

test('認得各種圖片的格式與尺寸', () => {
  const png = sniff(decodeBase64(PNG))
  expect(png).toEqual({ mime: 'image/png', width: 1, height: 1 })

  const gif = new Uint8Array(13)
  gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00, 0x20, 0x00])
  expect(sniff(gif)).toEqual({ mime: 'image/gif', width: 16, height: 32 })

  const bmp = new Uint8Array(30)
  bmp.set([0x42, 0x4d])
  bmp.set([0x40, 0x01, 0, 0], 18)
  // 由上往下存的 BMP 高度是負數
  bmp.set([0x38, 0xff, 0xff, 0xff], 22)
  expect(sniff(bmp)).toEqual({ mime: 'image/bmp', width: 320, height: 200 })

  const jpeg = new Uint8Array(40)
  jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0])
  jpeg.set([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x00, 0x02, 0x00], 8)
  expect(sniff(jpeg)).toEqual({ mime: 'image/jpeg', width: 512, height: 256 })

  const riff = (chunk: string, bytes: number[], at: number) => {
    const b = new Uint8Array(40)
    b.set([...'RIFF'].map(c => c.charCodeAt(0)))
    b.set([...`WEBP${chunk}`].map(c => c.charCodeAt(0)), 8)
    b.set(bytes, at)
    return b
  }
  expect(sniff(riff('VP8 ', [0x40, 0x01, 0xc8, 0x00], 26))).toEqual({ mime: 'image/webp', width: 320, height: 200 })
  expect(sniff(riff('VP8X', [0x3f, 0x01, 0x00, 0xc7, 0x00, 0x00], 24))).toEqual({
    mime: 'image/webp',
    width: 320,
    height: 200,
  })
  expect(sniff(riff('VP8L', [0x3f, 0x01, 0x20, 0x00], 21))?.width).toBe(320)

  expect(sniff(decodeBase64('QUJD'))).toBe(null)
})

test('小圖不呼叫任何外部工具', async ($, on) => {
  let processes = 0
  on('fs.exists', () => FILE_EXISTS)
  on('fs.read', () => ({ value: { base64: PNG } }))
  on('process.run', () => {
    processes += 1
    return ran('')
  })
  on('ui.invalidate', () => ({ value: undefined }))

  const answer = await $.tool.call({ tool: TOOL, path: 'a.png', caption: '說明' } as never)

  expect(String(answer.result)).toContain('1x1')
  expect(processes).toBe(0)
})

test('大圖在 Windows 用 PowerShell 縮小', async ($, on) => {
  const argv: string[][] = []
  on('fs.exists', () => FILE_EXISTS)
  on('fs.read', () => ({ value: { base64: TOO_BIG } }))
  on('env.get', () => ({ value: 'Windows_NT' }))
  on('process.run', (_, e) => {
    argv.push((e as unknown as { argv: string[] }).argv)
    return ran(PNG)
  })
  on('ui.invalidate', () => ({ value: undefined }))

  const answer = await $.tool.call({ tool: TOOL, path: 'big.png' } as never)

  expect(answer.deny).toBeUndefined()
  expect(argv[0]?.[0]).toBe('powershell.exe')
})

test('大圖在其他系統用 sh 縮小，太大就換更小的設定', async ($, on) => {
  const argv: string[][] = []
  on('fs.exists', () => FILE_EXISTS)
  on('fs.read', () => ({ value: { base64: TOO_BIG } }))
  on('env.get', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    argv.push((e as unknown as { argv: string[] }).argv)
    return ran(argv.length === 1 ? TOO_BIG : PNG)
  })
  on('ui.invalidate', () => ({ value: undefined }))

  const answer = await $.tool.call({ tool: TOOL, path: 'big.png' } as never)

  expect(answer.deny).toBeUndefined()
  expect(argv.length).toBe(2)
  expect(argv[0]?.[0]).toBe('sh')
  expect(argv[0]?.[4]).toBe('big.png')
})

test('沒有縮圖工具時說清楚要裝什麼', async ($, on) => {
  on('fs.exists', () => FILE_EXISTS)
  on('fs.read', () => ({ value: { base64: TOO_BIG } }))
  on('env.get', () => ({ value: undefined }))
  on('process.run', () => ran('', 127, 'no image tool'))

  const answer = await $.tool.call({ tool: TOOL, path: 'big.png' } as never)

  expect(answer.deny).toContain('ImageMagick')
})

test('檔案不存在時回報錯誤', async ($, on) => {
  on('fs.exists', () => ({ value: false }))

  const answer = await $.tool.call({ tool: TOOL, path: 'missing.png' } as never)

  expect(answer.deny).toContain('找不到檔案')
})

test('工具列在 VS Code 畫出嵌入的圖片，重開對話後也能重新載入', async ($, on) => {
  on('fs.exists', () => FILE_EXISTS)
  on('fs.read', () => ({ value: { base64: PNG } }))

  const ui = await $.ui.mount(row('call-after-resume', 'vscode'))

  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('data:image/png;base64,')
  expect((await ui.find({ type: 'Text' }))?.text).toBe('說明')
  await ui.unmount()
})

for (const [system, value, expected] of [
  ['Windows', 'Windows_NT', 'powershell.exe'],
  ['其他系統', undefined, 'sh'],
] as const) {
  test(`${system}按開啟原圖會用原本的路徑開檔`, async ($, on) => {
    const runs: string[] = []
    on('fs.exists', () => FILE_EXISTS)
    on('fs.read', () => ({ value: { base64: PNG } }))
    on('env.get', () => ({ value }))
    on('process.run', (_, e) => {
      runs.push(JSON.stringify(e))
      return ran('')
    })

    const ui = await $.ui.mount(row(`call-open-${system}`, 'vscode'))
    await ui.press({ key: 'open:a.png' })
    for (let i = 0; i < 50 && runs.length < 1; i++) await Promise.resolve()

    expect(runs.length).toBe(1)
    expect(runs[0]).toContain(expected)
    expect(runs[0]).toContain('--reuse-window')
    expect(runs[0]).toContain('a.png')
    await ui.unmount()
  })
}

test('SendUserFile 傳的圖片在 VS Code 畫成圖，其他檔案照舊', async ($, on) => {
  on('fs.exists', () => FILE_EXISTS)
  on('fs.read', () => ({ value: { base64: PNG } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const sent = (id: string, surface: 'vscode' | 'desktop', files: string[]) =>
    ({
      plugin: 'image-pane',
      component: 'ToolUse',
      requestId: id,
      surface,
      props: {
        tool_use_id: id,
        tool: 'SendUserFile',
        input: { files, caption: '截圖', status: 'normal' },
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
      },
    }) as never

  const picture = await $.ui.mount(sent('s1', 'vscode', ['shot.png', 'notes.txt']))
  expect(String((await picture.find({ type: 'Svg' }))?.props.source)).toContain('data:image/png;base64,')
  expect((await picture.find({ type: 'Text' }))?.text).toBe('截圖')
  await picture.unmount()

  for (const other of [sent('s2', 'vscode', ['report.pdf']), sent('s3', 'desktop', ['shot.png'])]) {
    const ui = await $.ui.mount(other)
    expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
    await ui.unmount()
  }
})

test('原檔不見了就回到原本的工具列', async ($, on) => {
  on('fs.exists', () => ({ value: false }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount(row('gone', 'vscode', { tool: 'SendUserFile', input: { files: ['gone.png'] } }))

  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('終端機與別的工具都留給原本的畫法', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  for (const mounted of [row('t1', 'terminal'), row('t2', 'vscode', { tool: 'Bash' })]) {
    const ui = await $.ui.mount(mounted)
    expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
    await ui.unmount()
  }
})
