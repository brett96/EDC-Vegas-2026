Add-Type -AssemblyName System.Drawing
foreach ($size in @(192, 512)) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(18, 8, 32))
  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush @(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 45, 196),
    [System.Drawing.Color]::FromArgb(120, 0, 255),
    45.0
  )
  $pad = [int]($size * 0.08)
  $g.FillEllipse($brush, $pad, $pad, ($size - 2 * $pad), ($size - 2 * $pad))
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([Math]::Max(2, $size / 64))
  $cx = $size / 2
  $cy = $size / 2
  $g.DrawLine($pen, $cx, ($cy - $size * 0.35), $cx, ($cy + $size * 0.12))
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $tip = [System.Drawing.PointF]::new($cx, ($cy - $size * 0.35))
  $left = [System.Drawing.PointF]::new(($cx - $size * 0.12), ($cy - $size * 0.12))
  $right = [System.Drawing.PointF]::new(($cx + $size * 0.12), ($cy - $size * 0.12))
  $path.AddLines(@($tip, $left, $right))
  $g.FillPath([System.Drawing.Brushes]::White, $path)
  $out = Join-Path $PSScriptRoot "..\icons\icon-$size.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}
