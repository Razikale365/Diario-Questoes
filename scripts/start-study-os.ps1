[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$venvRoot = Join-Path $repoRoot '.venv-study-os'
$venvPython = Join-Path $venvRoot 'Scripts\python.exe'
$pyprojectPath = Join-Path $repoRoot 'pyproject.toml'
$dependencyStamp = Join-Path $venvRoot 'study-os-pyproject.sha256'

function Get-Sha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha256.ComputeHash($stream)
    return ([System.BitConverter]::ToString($hash)).Replace('-', '')
  } finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

$dependencyHash = Get-Sha256 $pyprojectPath
$installedDependencyHash = if (Test-Path -LiteralPath $dependencyStamp) {
  (Get-Content -LiteralPath $dependencyStamp -Raw).Trim()
} else {
  ''
}
$healthUrl = 'http://127.0.0.1:4317/api/v1/health'
$service = $null
$viteExitCode = 0

function Require-Command([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Required command '$Name' was not found in PATH."
  }
  return $command
}

Set-Location $repoRoot
$npm = Require-Command 'npm.cmd'

if (-not (Test-Path -LiteralPath $venvPython)) {
  $python = Require-Command 'python'
  Write-Host 'Creating Study OS Python environment...'
  & $python.Source -m venv $venvRoot
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not create .venv-study-os.'
  }
}

if (-not (Test-Path -LiteralPath $venvPython)) {
  throw 'Study OS virtual environment is incomplete: python.exe is missing.'
}

if (-not $SkipInstall -and $installedDependencyHash -ne $dependencyHash) {
  Write-Host 'Installing updated Study OS local service dependencies...'
  & $venvPython -m pip install '.[dev]'
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not install Study OS service dependencies.'
  }
  Set-Content -LiteralPath $dependencyStamp -Value $dependencyHash -NoNewline
}

try {
  Write-Host 'Starting Study OS local service on 127.0.0.1:4317...'
  $service = Start-Process -FilePath $venvPython `
    -ArgumentList @('-m','uvicorn','study_os_service.app:create_app','--factory','--host','127.0.0.1','--port','4317') `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -PassThru

  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  $health = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($service.HasExited) {
      throw "Study OS service exited before becoming healthy (code $($service.ExitCode))."
    }
    try {
      $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
      if ($health.status -eq 'ok') { break }
    } catch {
      Start-Sleep -Milliseconds 300
    }
  }
  if (-not $health -or $health.status -ne 'ok') {
    throw 'Study OS service did not become healthy within 30 seconds.'
  }

  Write-Host "Study OS service ready (schema $($health.schemaVersion))."
  if (-not $NoBrowser) {
    Start-Process 'http://localhost:3000/'
  }

  & $npm.Source run dev
  $viteExitCode = $LASTEXITCODE
} finally {
  if ($service -and -not $service.HasExited) {
    Write-Host 'Stopping Study OS local service...'
    Stop-Process -Id $service.Id -ErrorAction SilentlyContinue
    $service.WaitForExit(5000) | Out-Null
  }
}

if ($viteExitCode -ne 0) {
  exit $viteExitCode
}
