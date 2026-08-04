# さいえん手帳の「仮」アイコン・スプラッシュを生成する（WBS 1.4b）
#
# ロゴは未確定（CLAUDE.md §7 / Q2）。確定するまでのプレースホルダーとして、
# 若葉パレットの双葉マークを描く。だいどこの臺所ロゴをそのまま出さないことが目的。
#
# Windows の System.Drawing で描いているため mac/CI では再生成できない。
# 生成物の PNG はリポジトリにコミットして使う（確定ロゴが来たら丸ごと差し替える）。
#
#   pwsh -File scripts/assets/generate-placeholder-icons.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$assets = Join-Path $root 'apps/mobile/assets'

# docs/画面設計.md §配色（若葉）
$bg = [System.Drawing.ColorTranslator]::FromHtml('#EAF3E0')   # accentSoft
$leaf = [System.Drawing.ColorTranslator]::FromHtml('#5B9B3E')  # accent
$leafDark = [System.Drawing.ColorTranslator]::FromHtml('#2F4A25') # accentInk

function P([single]$x, [single]$y) {
    New-Object System.Drawing.PointF($x, $y)
}

# 双葉。1024 の作業座標で描き、あとでキャンバスに合わせて拡縮・中央寄せする
function New-SproutPath {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath

    # 右の葉
    $path.AddBezier((P 512 512), (P 596 388), (P 762 372), (P 800 452))
    $path.AddBezier((P 800 452), (P 762 556), (P 606 580), (P 512 512))
    $path.CloseFigure()

    # 左の葉（右よりやや小さく、下にずらす）
    $path.StartFigure()
    $path.AddBezier((P 512 604), (P 436 512), (P 288 500), (P 250 572))
    $path.AddBezier((P 250 572), (P 286 664), (P 420 686), (P 512 604))
    $path.CloseFigure()

    return $path
}

# 茎。まっすぐだと作図に見えるので、わずかに S 字にする
function New-StemPath {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddBezier((P 516 800), (P 496 706), (P 528 600), (P 512 486))
    return $path
}

function Save-Mark {
    param(
        [string]$Path,
        [int]$Size,
        [bool]$FillBackground,
        # コンテンツを収める割合。Android のアダプティブアイコンは外周が切られる
        [single]$ContentRatio = 1.0
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    if ($FillBackground) {
        $g.Clear($bg)
    } else {
        $g.Clear([System.Drawing.Color]::Transparent)
    }

    $stem = New-StemPath
    $sprout = New-SproutPath

    # 茎の線幅ぶんを含めた実寸で中央に置く。座標をベタ書きで中央に寄せようとすると
    # 葉と茎の重心がずれて「左下に沈んだ」見た目になる（実際にそうなった）
    $stemWidth = 30.0
    $bounds = New-Object System.Drawing.Drawing2D.GraphicsPath
    $bounds.AddPath($sprout, $false)
    $bounds.AddPath($stem, $false)
    $box = $bounds.GetBounds()
    $box.Inflate($stemWidth / 2.0, $stemWidth / 2.0)

    $target = $Size * $ContentRatio
    $scale = [Math]::Min($target / $box.Width, $target / $box.Height)

    $m = New-Object System.Drawing.Drawing2D.Matrix
    $m.Translate([single](($Size - $box.Width * $scale) / 2.0 - $box.X * $scale),
                 [single](($Size - $box.Height * $scale) / 2.0 - $box.Y * $scale))
    $m.Scale([single]$scale, [single]$scale)
    $g.Transform = $m

    $pen = New-Object System.Drawing.Pen($leafDark, [single]$stemWidth)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawPath($pen, $stem)

    $brush = New-Object System.Drawing.SolidBrush($leaf)
    $g.FillPath($brush, $sprout)

    $g.Dispose()
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "wrote $Path"
}

# ストア/ランチャー用。背景込みの正方形
Save-Mark -Path (Join-Path $assets 'icon.png') -Size 1024 -FillBackground $true -ContentRatio 0.66

# Android アダプティブアイコンの前景。外周 33% は切られうるので中央に寄せる
Save-Mark -Path (Join-Path $assets 'adaptive-icon.png') -Size 1024 -FillBackground $false -ContentRatio 0.52

# スプラッシュ（app.json の backgroundColor に載るので背景は透過）
Save-Mark -Path (Join-Path $assets 'splash-icon.png') -Size 1024 -FillBackground $false -ContentRatio 0.62

# web の favicon
Save-Mark -Path (Join-Path $assets 'favicon.png') -Size 96 -FillBackground $true -ContentRatio 0.7
