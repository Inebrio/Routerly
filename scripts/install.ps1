# ────────────────────────────────────────────────────────────────────────────
# Routerly — Install script (Windows PowerShell)
#
# Usage:
#   powershell -c "irm https://your-domain.com/install.ps1 | iex"
#   or with flags:
#   powershell -c "& ([scriptblock]::Create((irm https://your-domain.com/install.ps1))) --yes"
# ────────────────────────────────────────────────────────────────────────────
[CmdletBinding()]
param(
  [switch]$Yes,
  [string]$Scope         = "",
  [string]$Port          = "",
  [string]$PublicUrl     = "",
  [switch]$NoService,
  [switch]$NoCli,
  [switch]$NoDashboard,
  [switch]$NoDaemon
)

$ErrorActionPreference = "Stop"

# ── Distribution config ───────────────────────────────────────────────────────
$GITHUB_OWNER = "Inebrio"
$GITHUB_REPO  = "Routerly"
$REQUIRED_NODE_MAJOR = 20

# ── Colors / helpers ──────────────────────────────────────────────────────────
function Write-Info    { param($msg) Write-Host "→ $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn    { param($msg) Write-Host "! $msg" -ForegroundColor Yellow }
function Write-Fail    { param($msg) Write-Host "✗ $msg" -ForegroundColor Red }
function Die           { param($msg) Write-Fail $msg; exit 1 }

Write-Host ""
Write-Host "  Routerly Installer" -ForegroundColor Cyan -NoNewline
Write-Host " — Self-hosted LLM Gateway" -ForegroundColor Gray
Write-Host ""

# ── Check PowerShell version ──────────────────────────────────────────────────
if ($PSVersionTable.PSVersion.Major -lt 5) {
  Die "PowerShell 5.0+ is required. Current: $($PSVersionTable.PSVersion)"
}

# ── Detect architecture ───────────────────────────────────────────────────────
$arch = if ([System.Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
Write-Info "Detected: Windows/$arch"

# ── Check Node.js ─────────────────────────────────────────────────────────────
function Test-NodeVersion {
  try {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) { return $false }
    $ver = (node -e "process.stdout.write(process.versions.node)").Trim()
    $major = [int]($ver.Split(".")[0])
    if ($major -ge $REQUIRED_NODE_MAJOR) {
      Write-Success "Node.js $ver found"
      return $true
    } else {
      Write-Warn "Node.js $ver found, but ${REQUIRED_NODE_MAJOR}+ is required"
      return $false
    }
  } catch {
    return $false
  }
}

function Install-Node {
  Write-Warn "Routerly requires Node.js ${REQUIRED_NODE_MAJOR}+."
  Write-Host ""
  Write-Host "  Install options:" -ForegroundColor Gray
  Write-Host "    winget install OpenJS.NodeJS.LTS" -ForegroundColor DarkGray
  Write-Host "    or download from https://nodejs.org" -ForegroundColor DarkGray
  Write-Host ""

  $useWinget = Get-Command winget -ErrorAction SilentlyContinue
  if ($useWinget) {
    $answer = Read-Host "  Install Node.js via winget now? [Y/n]"
    if ($answer -eq "" -or $answer -match "^[Yy]") {
      Write-Info "Running: winget install OpenJS.NodeJS.LTS"
      winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
      # Refresh PATH
      $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                  [System.Environment]::GetEnvironmentVariable("Path","User")
      return
    }
  }

  Die "Please install Node.js ${REQUIRED_NODE_MAJOR}+ from https://nodejs.org and re-run this script."
}

if (-not (Test-NodeVersion)) {
  Install-Node
  if (-not (Test-NodeVersion)) {
    Die "Node.js ${REQUIRED_NODE_MAJOR}+ still not available after install. Please restart your terminal and retry."
  }
}

$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
  Die "'npm' not found. Please ensure Node.js was installed correctly."
}

# ── Create temp directory ─────────────────────────────────────────────────────
$tmpDir = Join-Path $env:TEMP "routerly-install-$(Get-Random)"
New-Item -ItemType Directory -Path $tmpDir | Out-Null

function Cleanup {
  if (Test-Path $tmpDir) {
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
  }
}

# Register cleanup on exit
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Cleanup } | Out-Null

# ── Fetch latest release tarball ──────────────────────────────────────────────
Write-Info "Fetching latest Routerly release..."

$releaseApiUrl = "https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest"
$tarballUrl    = ""

try {
  $headers = @{ "User-Agent" = "routerly-installer/1.0" }
  $release = Invoke-RestMethod -Uri $releaseApiUrl -Headers $headers -ErrorAction Stop
  $tarballUrl = $release.tarball_url
} catch {
  Write-Warn "Could not fetch latest release from GitHub API. Falling back to main branch..."
}

if (-not $tarballUrl) {
  $tarballUrl = "https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/refs/heads/main.zip"
}

Write-Info "Downloading Routerly from: $tarballUrl"

$downloadFile = Join-Path $tmpDir "routerly-src.zip"
$extractDir   = Join-Path $tmpDir "source"

# GitHub tarball_url returns a .tar.gz; for Windows we request the zip
# If tarball_url ends in .tar.gz, swap to zipball_url equivalent
if ($tarballUrl -match "tarball") {
  $zipUrl = $tarballUrl -replace "/tarball/", "/zipball/"
  try {
    Invoke-WebRequest -Uri $zipUrl -OutFile $downloadFile -UseBasicParsing
  } catch {
    Write-Warn "zipball URL failed, trying fallback..."
    $zipUrl = "https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/refs/heads/main.zip"
    Invoke-WebRequest -Uri $zipUrl -OutFile $downloadFile -UseBasicParsing
  }
} else {
  Invoke-WebRequest -Uri $tarballUrl -OutFile $downloadFile -UseBasicParsing
}

Write-Info "Extracting archive..."
Expand-Archive -Path $downloadFile -DestinationPath $tmpDir -Force

# GitHub ZIP extraction creates a subdirectory like "owner-repo-SHA"
$subDir = Get-ChildItem -Path $tmpDir -Directory | Where-Object { $_.Name -ne "source" } | Select-Object -First 1
if ($subDir) {
  Rename-Item -Path $subDir.FullName -NewName "source"
}

New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

Write-Success "Downloaded and extracted source"

# ── Build argument list for install.mjs ───────────────────────────────────────
$installerArgs = @("--source-dir=$extractDir")

if ($Yes)          { $installerArgs += "--yes" }
if ($Scope)        { $installerArgs += "--scope=$Scope" }
if ($Port)         { $installerArgs += "--port=$Port" }
if ($PublicUrl)    { $installerArgs += "--public-url=$PublicUrl" }
if ($NoService)    { $installerArgs += "--no-service" }
if ($NoCli)        { $installerArgs += "--no-cli" }
if ($NoDashboard)  { $installerArgs += "--no-dashboard" }
if ($NoDaemon)     { $installerArgs += "--no-daemon" }

# ── Run the Node.js installer ─────────────────────────────────────────────────
$installer = Join-Path $extractDir "scripts\install.mjs"
if (-not (Test-Path $installer)) {
  Cleanup
  Die "Installer not found at expected path: $installer"
}

Write-Info "Launching Routerly installer..."
Write-Host ""

try {
  $proc = Start-Process -FilePath "node" -ArgumentList (@($installer) + $installerArgs) `
    -NoNewWindow -Wait -PassThru
  $exitCode = $proc.ExitCode
} catch {
  Cleanup
  Die "Failed to launch Node.js installer: $_"
}

Cleanup

if ($exitCode -ne 0) {
  exit $exitCode
}
