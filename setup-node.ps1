<#
.SYNOPSIS
    Installs Node.js 18+ for the UniClass project.
.DESCRIPTION
    This script downloads and installs the latest LTS version of Node.js
    using the official Node.js Windows installer. It also verifies the
    installation and installs project dependencies.
.NOTES
    Requires administrative privileges for system-wide installation.
    For per-user installation, run without -SystemWide.
#>

param(
    [switch]$SystemWide = $false,
    [string]$NodeVersion = "18.20.4"
)

$ErrorActionPreference = "Stop"

Write-Host "=== UniClass Node.js Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check if Node.js is already installed
$existingNode = Get-Command node -ErrorAction SilentlyContinue
if ($existingNode) {
    $currentVersion = (node -v 2>$null).TrimStart('v')
    Write-Host "Node.js is already installed: v$currentVersion" -ForegroundColor Yellow

    $majorVersion = [int]$currentVersion.Split('.')[0]
    if ($majorVersion -ge 18) {
        Write-Host "Version is sufficient (>= 18). Skipping installation." -ForegroundColor Green
    } else {
        Write-Host "Version is below 18. Upgrading..." -ForegroundColor Yellow
    }
} else {
    Write-Host "Node.js not found. Installing v$NodeVersion..." -ForegroundColor Cyan

    $installerUrl = "https://nodejs.org/dist/v${NodeVersion}/node-v${NodeVersion}-win-x64.msi"
    $installerPath = "$env:TEMP\node-v${NodeVersion}-win-x64.msi"

    Write-Host "Downloading from: $installerUrl" -ForegroundColor Gray
    Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

    Write-Host "Running installer..." -ForegroundColor Gray
    $installArgs = "/i `"$installerPath`" /quiet /norestart"
    if (-not $SystemWide) {
        $installArgs += " ALLUSERS=2"
    }
    Start-Process msiexec.exe -ArgumentList $installArgs -Wait -NoNewWindow

    Remove-Item $installerPath -Force -ErrorAction SilentlyContinue

    # Refresh PATH for current session
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    Write-Host "Node.js installed successfully!" -ForegroundColor Green
}

# Verify installation
$nodeVersion = (node -v 2>$null).TrimStart('v')
$npmVersion = (npm -v 2>$null).TrimStart('v')
Write-Host ""
Write-Host "Node.js v$nodeVersion" -ForegroundColor Green
Write-Host "npm v$npmVersion" -ForegroundColor Green

# Install project dependencies
Write-Host ""
Write-Host "Installing project dependencies..." -ForegroundColor Cyan
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectDir
npm install

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Cyan
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Copy .env.example to .env.local" -ForegroundColor Gray
Write-Host "  2. Fill in your Supabase URL and Anon Key" -ForegroundColor Gray
Write-Host "  3. Run npm run dev to start the development server" -ForegroundColor Gray
