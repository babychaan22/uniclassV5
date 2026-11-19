param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDirectory,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [Parameter(Mandatory = $true)]
    [string]$OutputZip
)

$ErrorActionPreference = 'Stop'

$colors = @{
    gold   = @(0.95, 0.69, 0.13); green = @(0.18, 0.68, 0.33); red = @(0.90, 0.20, 0.18)
    blue   = @(0.12, 0.48, 0.91); orange = @(0.95, 0.39, 0.08); purple = @(0.48, 0.24, 0.84)
    pink   = @(0.91, 0.18, 0.48); brown = @(0.55, 0.28, 0.10); teal = @(0.02, 0.60, 0.65)
    violet = @(0.55, 0.29, 0.75)
}

function Get-Theme([string]$FileName) {
    $name = $FileName.ToLowerInvariant()
    if ($name -match 'trophy|cup|crown|star|bitcoin|dogecoin|coin|money|wallet|bank|discount|piggy') { return 'gold' }
    if ($name -match 'plant|success|check|tether|android') { return 'green' }
    if ($name -match 'error|delete|medicine|bomb|heart_rate|syringe|virus|chiliz|tron|youtube') { return 'red' }
    if ($name -match 'pizza|burger|coffee|fire|sun|flash|light_bulb|key|flag|desk_lamp|vape|monero') { return 'orange' }
    if ($name -match 'music|gamepad|facebook|twitter|instagram|linkedin|telegram|whatsapp|discord|twitch|dribbble|polkadot|uniswap') { return 'purple' }
    if ($name -match 'briefcase|books|building|pencil|clipboard|glasses|chair|box|notebook|basket|brush|paints|apple') { return 'brown' }
    if ($name -match 'tools|target|compass|crosshair|gym|ping_pong|clock|calendar|user|contact|bell|gift') { return 'teal' }
    if ($name -match 'ethereum|cardano|chainlink|ripple|litecoin|stellar|usd_coin|dash|iota|eos|algorand|tezos|vechain|cosmos|solana|terra|theta|mco|nem|huobi|binance|ftx|webcam|radio|camera|video|microphone|sound') { return 'blue' }
    if ($name -match 'arrows|credit_card|diagram|image|location|message|pdf|browser|calculator|chart|play|tv|settings|shield|exchange|link|dashboard|cursor|rocket|phone|qr|code|magnifier|list|mobile|computer|envelope|logout|cloud|hosting|plus|save|shop|wifi|networking|tablet|email|laptop|database|firewall|comment|page|clip|battery|share') { return 'blue' }
    return 'violet'
}

function New-ColorFilter([double[]]$Rgb) {
    function F([double]$Value) { $Value.ToString('0.000', [cultureinfo]::InvariantCulture) }
    $r = @((F ($Rgb[0] * .2126)), (F ($Rgb[0] * .7152)), (F ($Rgb[0] * .0722))) -join ' '
    $g = @((F ($Rgb[1] * .2126)), (F ($Rgb[1] * .7152)), (F ($Rgb[1] * .0722))) -join ' '
    $b = @((F ($Rgb[2] * .2126)), (F ($Rgb[2] * .7152)), (F ($Rgb[2] * .0722))) -join ' '
    @"
  <filter id="semantic-color" color-interpolation-filters="sRGB">
    <feColorMatrix type="matrix" values="$r 0 0 $g 0 0 $b 0 0 0 0 1 0"/>
    <feComponentTransfer><feFuncR type="gamma" amplitude="1.15" exponent="0.88"/><feFuncG type="gamma" amplitude="1.15" exponent="0.88"/><feFuncB type="gamma" amplitude="1.15" exponent="0.88"/></feComponentTransfer>
  </filter>
"@
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$seenHashes = @{}
$duplicates = [System.Collections.Generic.List[string]]::new()
$summary = @{}
$files = Get-ChildItem -LiteralPath $SourceDirectory -Filter '*.svg' -File | Sort-Object Name
foreach ($file in $files) {
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    if ($seenHashes.ContainsKey($hash)) {
        $duplicates.Add("$($file.Name) (duplicate of $($seenHashes[$hash]))")
        continue
    }
    $seenHashes[$hash] = $file.Name
    $theme = Get-Theme $file.Name
    $svg = Get-Content -LiteralPath $file.FullName -Raw
    $svg = $svg -replace '<defs>', "<defs>`n$(New-ColorFilter $colors[$theme])"
    $svg = [regex]::Replace($svg, '<rect(?<attrs>[^>]*fill="url\(#pattern[^"]+\)"[^>]*)/>', '<rect${attrs} filter="url(#semantic-color)"/>', 1)
    if ($svg -notmatch 'filter="url\(#semantic-color\)"') { throw "Could not apply color filter to $($file.Name)" }
    Set-Content -LiteralPath (Join-Path $OutputDirectory $file.Name) -Value $svg -NoNewline -Encoding utf8
    if (-not $summary.ContainsKey($theme)) { $summary[$theme] = 0 }
    $summary[$theme]++
}

if (Test-Path -LiteralPath $OutputZip) { Remove-Item -LiteralPath $OutputZip -Force }
Compress-Archive -Path (Join-Path $OutputDirectory '*') -DestinationPath $OutputZip

Write-Output "Source icons: $($files.Count)"
Write-Output "Unique icons exported: $($seenHashes.Count)"
Write-Output "Exact duplicates removed: $($duplicates.Count)"
$summary.GetEnumerator() | Sort-Object Name | ForEach-Object { Write-Output ("{0}: {1}" -f $_.Key, $_.Value) }
Write-Output $OutputZip
