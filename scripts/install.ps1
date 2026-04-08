#Requires -Version 5.1
<#
.SYNOPSIS
    Build and install FAM on Windows.

.DESCRIPTION
    1. Checks prerequisites (Node.js >= 22, npm)
    2. Installs dependencies (npm ci)
    3. Builds the project (npm run build)
    4. Copies dist/ and node_modules to the install directory
    5. Creates a `fam.cmd` wrapper on PATH
    6. Creates ~\.fam\ data directory

.PARAMETER Prefix
    Install prefix directory. Default: $env:LOCALAPPDATA\fam
    Binary wrapper goes to <prefix>\bin\fam.cmd
    Library goes to <prefix>\lib\

.PARAMETER AddToPath
    Automatically add the bin directory to the user's PATH. Default: $true

.EXAMPLE
    .\scripts\install.ps1
    .\scripts\install.ps1 -Prefix "$env:USERPROFILE\fam"
#>

param(
    [string]$Prefix = "$env:LOCALAPPDATA\fam",
    [bool]$AddToPath = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ─── Paths ────────────────────────────────────────────────────────

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$BinDir = Join-Path $Prefix "bin"
$LibDir = Join-Path $Prefix "lib"
$FamHome = Join-Path $env:USERPROFILE ".fam"

# ─── Helpers ──────────────────────────────────────────────────────

function Write-Info  { param([string]$Msg) Write-Host "[+] $Msg" -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host "[!] $Msg" -ForegroundColor Yellow }
function Write-Fail  { param([string]$Msg) Write-Host "[x] $Msg" -ForegroundColor Red; exit 1 }
function Write-Dim   { param([string]$Msg) Write-Host "    $Msg" -ForegroundColor DarkGray }

# ─── Prerequisites ────────────────────────────────────────────────

Write-Info "Checking prerequisites..."

try {
    $nodeVersion = (node -v) -replace '^v', ''
    $nodeMajor = [int]($nodeVersion.Split('.')[0])
    if ($nodeMajor -lt 22) {
        Write-Fail "Node.js >= 22 required (found v$nodeVersion). Update: https://nodejs.org/"
    }
    Write-Dim "Node.js v$nodeVersion"
} catch {
    Write-Fail "Node.js not found. Install Node.js >= 22: https://nodejs.org/"
}

try {
    $npmVersion = npm -v
    Write-Dim "npm $npmVersion"
} catch {
    Write-Fail "npm not found. It should come with Node.js."
}

# ─── Build ────────────────────────────────────────────────────────

Write-Info "Installing dependencies..."
Push-Location $ProjectRoot
try {
    npm ci --ignore-scripts 2>&1 | Select-Object -Last 1

    Write-Info "Compiling native modules..."
    npm rebuild better-sqlite3 2>&1 | Select-Object -Last 1

    Write-Info "Building FAM..."
    npm run build 2>&1 | Select-Object -Last 1

    $distEntry = Join-Path $ProjectRoot "dist\index.js"
    if (-not (Test-Path $distEntry)) {
        Write-Fail "Build failed: dist\index.js not found"
    }
    Write-Dim "Build complete: dist\index.js"
} finally {
    Pop-Location
}

# ─── Install ──────────────────────────────────────────────────────

Write-Info "Installing to $LibDir ..."

# Create directories
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
New-Item -ItemType Directory -Path $LibDir -Force | Out-Null

# Copy dist and package files
Copy-Item -Path (Join-Path $ProjectRoot "dist") -Destination $LibDir -Recurse -Force
Copy-Item -Path (Join-Path $ProjectRoot "package.json") -Destination $LibDir -Force
$lockFile = Join-Path $ProjectRoot "package-lock.json"
if (Test-Path $lockFile) {
    Copy-Item -Path $lockFile -Destination $LibDir -Force
}

# Install production dependencies only
Push-Location $LibDir
try {
    npm ci --omit=dev 2>&1 | Select-Object -Last 1
} finally {
    Pop-Location
}

# Create fam.cmd wrapper
$cmdWrapper = Join-Path $BinDir "fam.cmd"
$libEntry = Join-Path $LibDir "dist\index.js"
@"
@echo off
node "$libEntry" %*
"@ | Set-Content -Path $cmdWrapper -Encoding ASCII

Write-Dim "Wrapper: $cmdWrapper"

# Also create a PowerShell wrapper for PS users
$ps1Wrapper = Join-Path $BinDir "fam.ps1"
@"
#!/usr/bin/env pwsh
node "$libEntry" @args
"@ | Set-Content -Path $ps1Wrapper -Encoding UTF8

Write-Dim "PS wrapper: $ps1Wrapper"

# ─── Data Directory ───────────────────────────────────────────────

Write-Info "Creating data directory at $FamHome ..."
New-Item -ItemType Directory -Path $FamHome -Force | Out-Null

# ─── Daemon Auto-Start (Windows Task Scheduler) ──────────────────

Write-Info "Setting up daemon auto-start (Task Scheduler)..."

$taskName = "FAM Daemon"
$nodeExe = (Get-Command node).Source
$libEntry = Join-Path $LibDir "dist\index.js"

# Remove existing task if present
schtasks /Delete /TN $taskName /F 2>$null | Out-Null

# Create a task that runs at user logon
$action = "cmd /c `"$nodeExe`" `"$libEntry`" daemon start --foreground > `"$FamHome\daemon.log`" 2>&1"
schtasks /Create /TN $taskName /TR $action /SC ONLOGON /RL LIMITED /F 2>$null | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Dim "Task '$taskName' registered (runs at logon)"

    # Start the daemon now
    Start-Process -NoNewWindow -FilePath $nodeExe -ArgumentList "`"$libEntry`" daemon start --foreground" -RedirectStandardOutput "$FamHome\daemon.log" -RedirectStandardError "$FamHome\daemon.err" -WindowStyle Hidden
    Write-Dim "Daemon started"
} else {
    Write-Warn "Could not register scheduled task. Start the daemon manually: fam daemon start"
}

# ─── PATH ─────────────────────────────────────────────────────────

$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
$pathEntries = $currentPath -split ";"

if ($pathEntries -notcontains $BinDir) {
    if ($AddToPath) {
        Write-Info "Adding $BinDir to user PATH..."
        $newPath = "$BinDir;$currentPath"
        [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
        $env:PATH = "$BinDir;$env:PATH"
        Write-Dim "Added to user PATH (takes effect in new terminals)"
    } else {
        Write-Warn "$BinDir is not in your PATH."
        Write-Host ""
        Write-Host "  Add it manually:" -ForegroundColor White
        Write-Host ""
        Write-Host "    `$env:PATH = `"$BinDir;`$env:PATH`""
        Write-Host ""
        Write-Host "  Or permanently via System Settings > Environment Variables"
        Write-Host ""
    }
} else {
    Write-Dim "$BinDir already in PATH"
}

# ─── Verify ───────────────────────────────────────────────────────

try {
    $famVersion = & "$cmdWrapper" --version 2>&1
    Write-Info "FAM $famVersion installed successfully."
} catch {
    Write-Info "FAM installed to $cmdWrapper"
    Write-Warn "Open a new terminal to use 'fam' globally."
}

Write-Host ""
Write-Host "Get started:" -ForegroundColor Green
Write-Host "  fam init              # Create fam.yaml"
Write-Host "  fam --help            # All commands"
Write-Host ""
