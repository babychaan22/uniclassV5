param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDirectory,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [Parameter(Mandatory = $true)]
    [string]$OutputZip
)

$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

# A 2.25x saturation matrix. It retains alpha and the original luminance, so
# transparent pixels, silhouettes, shadows, and highlights remain unchanged.
$filter = @'
  <filter id="vibrant-color" color-interpolation-filters="sRGB">
    <feColorMatrix type="matrix" values="1.983 -0.894 -0.090 0 0 -0.266 1.608 -0.090 0 0 -0.266 -0.894 2.160 0 0 0 0 0 1 0"/>
  </filter>
'@

$svgFiles = Get-ChildItem -LiteralPath $SourceDirectory -Filter '*.svg' -File
foreach ($file in $svgFiles) {
    $svg = Get-Content -LiteralPath $file.FullName -Raw
    $svg = $svg -replace '<g id="([^"]+)">', '<g id="$1" filter="url(#vibrant-color)">'
    $svg = $svg -replace '<defs>', "<defs>`n$filter"
    Set-Content -LiteralPath (Join-Path $OutputDirectory $file.Name) -Value $svg -NoNewline -Encoding utf8
}

if (Test-Path -LiteralPath $OutputZip) {
    Remove-Item -LiteralPath $OutputZip -Force
}
Compress-Archive -Path (Join-Path $OutputDirectory '*') -DestinationPath $OutputZip

Write-Output ("Created {0} vibrant SVG icons." -f $svgFiles.Count)
Write-Output $OutputZip
