# image-pane

[![CI](https://github.com/LaiYueJi/image-pane/actions/workflows/ci.yml/badge.svg)](https://github.com/LaiYueJi/image-pane/actions/workflows/ci.yml)

讓 Claude Code 的 VS Code 面板直接顯示圖片。

VS Code 面板不會顯示 Claude 回覆裡的圖片，截圖、圖表都只能另外開檔案看。裝了這個插件，Claude 可以把圖畫在對話裡。

[English](#english)

## 功能

- **圖片畫在對話裡**：Claude 用內建的 `SendUserFile` 傳圖時，VS Code 裡那一列會變成圖片，網頁版與手機照常收到。
- **沒開遠端控制也能看**：沒有 `SendUserFile` 時，Claude 改用插件的 `show_image` 工具，圖片只顯示在本機。
- **開啟原圖**：圖片下方有按鈕，點了用 VS Code 分頁開原始檔。
- **自動縮圖**：太大的圖會自動縮小，放得下的圖則原檔顯示。
- **支援格式**：PNG、JPEG、GIF、BMP、WebP、SVG。

## 安裝

需要 Claude Code 的 VS Code 擴充 2.1.299 以上。

**在 VS Code：**

1. 在 Claude 輸入框打 `/plugins`。
2. 到 **Marketplaces** 分頁，加入 `LaiYueJi/image-pane`。
3. 到 **Plugins** 分頁，找到 `image-pane` 按 **Install**，選 **Install for you**。

**在終端機：**

```
claude plugin install image-pane --marketplace LaiYueJi/image-pane
```

裝好後每個對話都會自動載入。

**更新**：第三方來源預設不會自動更新。到 `/plugins` 的 **Marketplaces** 分頁可以手動更新或開啟自動更新。

**移除**：

```
claude plugin uninstall image-pane
```

## 使用

直接跟 Claude 說「把截圖給我看」就好，它會自己傳圖。

你也可以自己開圖，這時圖片會顯示在面板裡：

```
/img C:\path\to\image.png
```

## 縮圖工具

小圖不需要任何工具。太大的圖要先縮小，各系統用的工具是：

| 系統 | 工具 |
| :- | :- |
| Windows | PowerShell，系統內建 |
| macOS | `sips`，系統內建 |
| Linux | ImageMagick，要自己裝，例如 `sudo apt install imagemagick` |

## 佔用空間

插件不會另外存圖片。面板上的縮圖只放在記憶體，關閉對話就釋放；重開對話時再從原本的路徑讀一次。

- **原檔**：留在原本的位置，要自己清。
- **原檔刪除或搬走後**：重開對話時，那一列會變回一般的工具呼叫列，不會出錯。
- **網頁版與手機的那份**：由 Claude Code 內建的 `SendUserFile` 上傳，與插件無關。

## 限制

- **面板裡的圖可能被縮小**：Claude Code 限制單張 SVG 的大小，大約只放得下 95 KB 的圖。要看清楚細節請按「開啟原圖」。
- **終端機不顯示圖片**：在終端機裡執行 `claude` 時，只會看到一般的工具呼叫列。
- **網頁版與手機需要遠端控制**：沒開的話只會顯示在本機。
- **操作介面目前只有繁體中文**。

## 測試狀況

- **Windows + VS Code**：實際使用確認過，包含網頁版收圖與「開啟原圖」。
- **macOS、Linux**：自動測試涵蓋縮圖流程，但畫面還沒在這兩個系統上實際確認過。
- **桌面版**：官方文件列為支援，但還沒實際確認過。

遇到問題歡迎開 [Issue](https://github.com/LaiYueJi/image-pane/issues)。

## 權限與隱私

插件和 Claude Code 用同樣的權限執行。它只會讀取你或 Claude 指定的圖片路徑，縮圖與開檔時呼叫上面列的系統工具，不會自己連網路，也不會把圖片傳到任何地方。傳到網頁版是 Claude Code 內建的 `SendUserFile` 做的，插件不經手。

圖片只顯示給你看，不會送給 Claude。Claude 要看圖的話要另外用 Read 工具讀取。

## 授權

[MIT](LICENSE)

---

## English

Shows images right in the Claude Code VS Code panel, which otherwise doesn't render them.

- When Claude sends an image with the built-in `SendUserFile` tool, that row in VS Code becomes the picture. The web and mobile apps receive it as usual.
- Without Remote Control there is no `SendUserFile`, so Claude uses the plugin's `show_image` tool. That picture appears only on your machine.
- An "open original" button below it (labelled 開啟原圖) opens the full file in a VS Code tab.
- Large images are downscaled automatically. Formats: PNG, JPEG, GIF, BMP, WebP, SVG.

**Install** (VS Code extension 2.1.299 or later): type `/plugins` in the prompt box, add `LaiYueJi/image-pane` on the **Marketplaces** tab, then install `image-pane` on the **Plugins** tab. Or from a terminal:

```
claude plugin install image-pane --marketplace LaiYueJi/image-pane
```

**Use**: ask Claude to show you the screenshot, or run `/img <path>` to open one in a pane.

**Downscaling tools**: small images need none. Large ones use PowerShell on Windows and `sips` on macOS, both built in. On Linux, install ImageMagick.

**Disk space**: the plugin saves no copies. Panel previews live in memory and are read again from the original path when you reopen a conversation. If the original file is gone, the row falls back to the normal tool call row.

**Limits**: the terminal shows no pictures, and the plugin's interface is in Traditional Chinese only.

**Tested**: used for real on Windows with VS Code. Automated tests cover downscaling on macOS and Linux, but the panel hasn't been checked by hand there.
