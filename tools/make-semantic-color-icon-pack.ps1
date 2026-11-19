param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDirectory,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [Parameter(Mandatory = $true)]
    [string]$OutputZip
)

$ErrorActionPreference = 'Stop'

# Each source icon is colorized from its original luminance. This preserves the
# 3D shading and transparent pixels while assigning a clear real-world color.
$themes = @{
    gold   = @('win-cup*', 'circle-crown*', 'star-icon.svg', 'diploma*', 'medal*')
    green  = @('plant*', 'tree-icon.svg', 'eco-friendly*', 'recycle*', 'salad*', 'mountain*')
    red    = @('ambulance*', 'heartbeat*', 'stethoscope*', 'medicine-bottles*', 'bomb-icon.svg')
    blue   = @('airplane*', 'water-bottle*', 'umbrella*', 'globes*', 'map-icon.svg', 'laptop*', 'headphone*', 'microphone*', 'photo-camera*', 'movie-clapper*', 'stock-tickers*', 'calculator*', 'atm-icon.svg', 'credit-card*')
    orange = @('pizza-icon.svg', 'burger-icon.svg', 'cake-icon.svg', 'ice-cream*', 'coffee-cup*', 'sushi-icon.svg', 'wine-glass*', 'bottle-icon.svg', 'cone-ice-cream*')
    purple = @('gamepad*', 'playing-cards*', 'chess-icon.svg', 'theatre-masks*', 'musical-note*', 'guitar-icon.svg', 'casino-icon.svg')
    teal   = @('bicycle*', 'car-icon.svg', 'school-bus*', 'running-shoe*', 'dumbbell*', 'yoga-pose*', 'volleyball-ball*', 'tent-icon.svg', 'backpack-icon.svg', 'suitcase*', 'suitcases*', 'passports*')
    pink   = @('gift-icon.svg', 'ballon-icon.svg', 'bell-icon.svg', 'handshake-icon.svg')
    brown  = @('small-home*', 'cityscapes*', 'landmark*', 'blackboard*', 'notebook*', 'closed-book*', 'briefcase*', 'safe-icon.svg', 'wallet-icon.svg', 'box*', 'paint-brushes*', 'pencil-icon.svg')
}

$colors = @{
    gold   = @(0.95, 0.69, 0.13)
    green  = @(0.18, 0.68, 0.33)
    red    = @(0.90, 0.20, 0.18)
    blue   = @(0.12, 0.48, 0.91)
    orange = @(0.95, 0.39, 0.08)
    purple = @(0.48, 0.24, 0.84)
    teal   = @(0.02, 0.60, 0.65)
    pink   = @(0.91, 0.18, 0.48)
    brown  = @(0.55, 0.28, 0.10)
    violet = @(0.55, 0.29, 0.75)
}

function Get-Theme([string]$FileName) {
    foreach ($theme in $themes.Keys) {
        foreach ($pattern in $themes[$theme]) {
            if ($FileName -like $pattern) { return $theme }
        }
    }
    return 'violet'
}

function New-ColorFilter([double[]]$Rgb) {
    function Format-Value([double]$Value) { return $Value.ToString('0.000', [cultureinfo]::InvariantCulture) }
    $r = @((Format-Value ($Rgb[0] * 0.2126)), (Format-Value ($Rgb[0] * 0.7152)), (Format-Value ($Rgb[0] * 0.0722))) -join ' '
    $g = @((Format-Value ($Rgb[1] * 0.2126)), (Format-Value ($Rgb[1] * 0.7152)), (Format-Value ($Rgb[1] * 0.0722))) -join ' '
    $b = @((Format-Value ($Rgb[2] * 0.2126)), (Format-Value ($Rgb[2] * 0.7152)), (Format-Value ($Rgb[2] * 0.0722))) -join ' '
    return @"
  <filter id="semantic-color" color-interpolation-filters="sRGB">
    <feColorMatrix type="matrix" values="$r 0 0 $g 0 0 $b 0 0 0 0 1 0"/>
    <feComponentTransfer>
      <feFuncR type="gamma" amplitude="1.15" exponent="0.88" offset="0"/>
      <feFuncG type="gamma" amplitude="1.15" exponent="0.88" offset="0"/>
      <feFuncB type="gamma" amplitude="1.15" exponent="0.88" offset="0"/>
    </feComponentTransfer>
  </filter>
"@
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$summary = @{}
$svgFiles = Get-ChildItem -LiteralPath $SourceDirectory -Filter '*.svg' -File
foreach ($file in $svgFiles) {
    $theme = Get-Theme $file.Name
    $filter = New-ColorFilter $colors[$theme]
    $svg = Get-Content -LiteralPath $file.FullName -Raw
    $svg = $svg -replace '<g id="([^"]+)">', '<g id="$1" filter="url(#semantic-color)">'
    $svg = $svg -replace '<defs>', "<defs>`n$filter"
    Set-Content -LiteralPath (Join-Path $OutputDirectory $file.Name) -Value $svg -NoNewline -Encoding utf8
    if (-not $summary.ContainsKey($theme)) { $summary[$theme] = 0 }
    $summary[$theme]++
}

if (Test-Path -LiteralPath $OutputZip) {
    Remove-Item -LiteralPath $OutputZip -Force
}
Compress-Archive -Path (Join-Path $OutputDirectory '*') -DestinationPath $OutputZip

Write-Output ("Created {0} semantically recolored SVG icons." -f $svgFiles.Count)
$summary.GetEnumerator() | Sort-Object Name | ForEach-Object { Write-Output ("{0}: {1}" -f $_.Key, $_.Value) }
Write-Output $OutputZip
