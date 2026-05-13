Add-Type -AssemblyName System.Drawing
foreach ($size in @(192, 512)) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(8, 4, 14))
  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size

  # Maskable-safe padding (keep logo away from edges)
  $pad = [int]($size * 0.14)
  $safe = New-Object System.Drawing.Rectangle $pad, $pad, ($size - 2 * $pad), ($size - 2 * $pad)

  # Create an "EDC" wordmark-style icon (simple, high-contrast, works as maskable).
  $txt = "EDC"
  $fontName = "Impact"
  $fontStyle = [System.Drawing.FontStyle]::Bold
  try {
    $font = New-Object System.Drawing.Font $fontName, 128, $fontStyle, ([System.Drawing.GraphicsUnit]::Pixel)
  } catch {
    $font = New-Object System.Drawing.Font "Arial Black", 128, $fontStyle, ([System.Drawing.GraphicsUnit]::Pixel)
  }

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Near
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Near

  # Build at origin, then scale/center into the safe area so all letters fit.
  $path.AddString(
    $txt,
    $font.FontFamily,
    [int]$font.Style,
    $font.Size,
    ([System.Drawing.PointF]::new(0, 0)),
    $sf
  )

  $b = $path.GetBounds()
  $scale = [Math]::Min(($safe.Width / $b.Width), ($safe.Height / $b.Height))
  $m = New-Object System.Drawing.Drawing2D.Matrix
  $m.Translate(-$b.X, -$b.Y)
  $m.Scale([float]$scale, [float]$scale)
  $path.Transform($m)

  $b2 = $path.GetBounds()
  $m2 = New-Object System.Drawing.Drawing2D.Matrix
  $m2.Translate([float]($safe.X + ($safe.Width - $b2.Width) / 2.0 - $b2.X), [float]($safe.Y + ($safe.Height - $b2.Height) / 2.0 - $b2.Y))
  $path.Transform($m2)

  # Soft glow behind the text
  $glowPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(120, 255, 45, 196)), ([Math]::Max(8, $size / 18))
  $glowPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawPath($glowPen, $path)

  # Gradient fill (EDC neon vibe)
  $fill = New-Object System.Drawing.Drawing2D.LinearGradientBrush @(
    $safe,
    [System.Drawing.Color]::FromArgb(255, 255, 45, 196),
    [System.Drawing.Color]::FromArgb(255, 0, 245, 255),
    15.0
  )
  $g.FillPath($fill, $path)

  # Crisp outline for legibility on any background
  $outline = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(245, 255, 255, 255)), ([Math]::Max(3, $size / 70))
  $outline.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawPath($outline, $path)

  $out = Join-Path $PSScriptRoot "..\icons\icon-$size.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $path.Dispose()
  $m.Dispose()
  $m2.Dispose()
  $sf.Dispose()
  $font.Dispose()
  $fill.Dispose()
  $outline.Dispose()
  $glowPen.Dispose()
  $g.Dispose()
  $bmp.Dispose()
}
