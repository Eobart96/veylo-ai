# Render the repository's V mark using Windows drawing APIs; no downloads.
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path $PSScriptRoot -Parent
$iconRoot = Join-Path $projectRoot 'src-tauri/icons'
foreach ($size in @(32,128,256)) {
    $bitmap = [Drawing.Bitmap]::new($size,$size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform($size/256.0,$size/256.0)
    $shape = [Drawing.Drawing2D.GraphicsPath]::new()
    $shape.AddArc(0,0,128,128,180,90); $shape.AddArc(128,0,128,128,270,90)
    $shape.AddArc(128,128,128,128,0,90); $shape.AddArc(0,128,128,128,90,90); $shape.CloseFigure()
    $brush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#202126'))
    $graphics.FillPath($brush,$shape); $brush.Dispose(); $shape.Dispose()
    $points = [Drawing.PointF[]]@([Drawing.PointF]::new(48,64),[Drawing.PointF]::new(86,64),[Drawing.PointF]::new(128,169),[Drawing.PointF]::new(170,64),[Drawing.PointF]::new(208,64),[Drawing.PointF]::new(145,192),[Drawing.PointF]::new(111,192))
    $brush=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#dce2ee'))
    $graphics.FillPolygon($brush,$points); $brush.Dispose()
    $brush=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#a8b6d2'))
    $graphics.FillRectangle($brush,179,42,22,22); $brush.Dispose()
    $name = if($size -eq 256){'128x128@2x.png'}else{"${size}x${size}.png"}
    $bitmap.Save((Join-Path $iconRoot $name),[Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose(); $bitmap.Dispose()
}
$images = @('32x32.png','128x128.png','128x128@2x.png') | ForEach-Object { ,([IO.File]::ReadAllBytes((Join-Path $iconRoot $_))) }
$stream=[IO.File]::Create((Join-Path $iconRoot 'icon.ico')); $writer=[IO.BinaryWriter]::new($stream)
try {
    $writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]3);$offset=6+16*3
    for($i=0;$i -lt 3;$i++) {
        $size=@(32,128,0)[$i];$writer.Write([byte]$size);$writer.Write([byte]$size);$writer.Write([byte]0);$writer.Write([byte]0)
        $writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$images[$i].Length);$writer.Write([uint32]$offset);$offset+=$images[$i].Length
    }
    foreach($bytes in $images){$writer.Write([byte[]]$bytes)}
} finally {$writer.Dispose();$stream.Dispose()}
Write-Output 'VEYLO_ICONS_OK'
