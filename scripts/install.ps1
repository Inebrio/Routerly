# ────────────────────────────────────────────────────────────────────────────
# Routerly — Install script (Windows PowerShell)
#
# Usage:
#   powershell -c "irm https://your-domain.com/install.ps1 | iex"
#   or with flags:
#   powershell -c "& ([scriptblock]::Create((irm https://your-domain.com/install.ps1))) -Yes"
#   powershell -c "& ([scriptblock]::Create((irm https://your-domain.com/install.ps1))) -Channel current"
#   powershell -c "& ([scriptblock]::Create((irm https://your-domain.com/install.ps1))) -Channel next"
#   powershell -c "& ([scriptblock]::Create((irm https://your-domain.com/install.ps1))) -Channel develop"
#   powershell -c "& ([scriptblock]::Create((irm https://your-domain.com/install.ps1))) -Version v0.2.0"
#
# -Channel and -Version are resolved here; all other flags are forwarded to install.mjs.
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
  [switch]$NoDaemon,
  [string]$Channel       = "current",  # latest | current | next | develop
  [string]$Version       = ""         # e.g. v0.2.0 — overrides -Channel when set
)

$ErrorActionPreference = "Stop"

# Whether -Channel was explicitly supplied on the command line (vs. the default).
$ChannelExplicit = $PSBoundParameters.ContainsKey('Channel')

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
# When running as Administrator, user-scoped installs (nvm, Volta, fnm, etc.) may
# not appear in the system PATH. Probe the most common Windows install locations
# and add the first one found to $env:Path so Test-NodeVersion can find it.
foreach ($loc in @(
    "$env:ProgramFiles\nodejs",
    "${env:ProgramFiles(x86)}\nodejs",
    "$env:LOCALAPPDATA\Programs\nodejs",
    "$env:APPDATA\npm"
  )) {
  if ((Test-Path "$loc\node.exe") -and ($env:Path -notlike "*$loc*")) {
    $env:Path = "$loc;$env:Path"
    break
  }
}

function Test-NodeVersion {
  try {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) { return $false }
    # Use --version (outputs 'v24.x.x') which is more reliable than -e in all PS versions
    $ver = (& node --version 2>$null)
    if (-not $ver) { return $false }
    $ver = $ver.TrimStart('v').Trim()
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

# ── Resolve download URL from channel or version ──────────────────────────────
function Resolve-DownloadUrl {
  $headers = @{ "User-Agent" = "routerly-installer/1.0" }
  $apiBase = "https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases"
  $release = $null

  try {
    if ($Version) {
      Write-Info "Resolving version $Version..."
      $release = Invoke-RestMethod -Uri "$apiBase/tags/$Version" -Headers $headers -ErrorAction Stop
    } elseif ($Channel -ceq "latest" -or $Channel -ceq "current") {
      Write-Info "Resolving channel $Channel..."
      # /releases/latest skips pre-releases, which hides every 0.3+ build, so
      # pick the highest plain vX.Y.Z tag from the release list instead.
      $newest = Invoke-RestMethod -Uri "${apiBase}?per_page=100" -Headers $headers -ErrorAction Stop |
        Where-Object { $_.tag_name -match '^v\d+\.\d+\.\d+$' } |
        Sort-Object { [version]$_.tag_name.Substring(1) } -Descending | Select-Object -First 1
      $release = if ($newest) { $newest } else { Invoke-RestMethod -Uri "$apiBase/latest" -Headers $headers -ErrorAction Stop }
    } elseif ($Channel -ceq "next" -or $Channel -ceq "develop") {
      Write-Info "Resolving channel $Channel..."
      try {
        $release = Invoke-RestMethod -Uri "$apiBase/tags/channel-$Channel" -Headers $headers -ErrorAction Stop
      } catch {
        # Releases published before the pointer tags were renamed use the bare name.
        $release = Invoke-RestMethod -Uri "$apiBase/tags/$Channel" -Headers $headers -ErrorAction Stop
      }
    } else {
      Die "Unknown channel: '$Channel'. Valid values: latest, current, next, develop"
    }
    # Pointer releases carry no version tag of their own: it is in the title.
    $tag = $release.tag_name
    if ($release.name -match '\(\u2192 (v[^)]+)\)') { $tag = $Matches[1] }
    return @{ TarballUrl = "https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/refs/tags/$tag.zip"; Tag = $tag }
  } catch {
    if ($Version) {
      Die "Could not find release '$Version' on GitHub. Check the version tag and retry."
    }
    if ($ChannelExplicit) {
      Die "Could not fetch channel '$Channel' from the GitHub API. Check your network and retry."
    }
    Write-Warn "Could not fetch release from GitHub API. Falling back to main branch..."
    return @{ TarballUrl = ""; Tag = "" }
  }
}

# ── Fetch release tarball ─────────────────────────────────────────────────────
$resolved    = Resolve-DownloadUrl
$tarballUrl  = $resolved.TarballUrl
$resolvedTag = $resolved.Tag

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
if ($resolvedTag)  { $installerArgs += "--version=$resolvedTag" }
if ($Version)      { $installerArgs += "--pinned" }
$installerArgs += "--channel=$Channel"

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
