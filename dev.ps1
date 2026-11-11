#Requires -Version 5.1
<#
.SYNOPSIS
  Restart Regos Wholesale in development mode with ngrok on port 8000.

.DESCRIPTION
  Stops any previous run tracked by this script (and frees ports 8000/8080),
  starts ngrok http 8000, updates backend/.env with the public HTTPS URL,
  then launches uvicorn (8000) and the Vite frontend (8080) as tabs in one
  Windows Terminal window.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$PidFile = Join-Path $Root ".dev-pids.json"
$RunDir = Join-Path $Root ".dev-run"
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$EnvFile = Join-Path $BackendDir ".env"
$VenvPython = Join-Path $BackendDir "venv\Scripts\python.exe"
$BackendPort = 8000
$FrontendPort = 8080
$NgrokApi = "http://127.0.0.1:4040/api/tunnels"
$NgrokWaitSeconds = 30

function Write-Step([string]$Message) {
    Write-Host "[dev] $Message" -ForegroundColor Cyan
}

function Write-Fail([string]$Message) {
    Write-Host "[dev] $Message" -ForegroundColor Red
}

function Get-WindowsTerminal {
    $cmd = Get-Command wt.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $fallback = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\wt.exe"
    if (Test-Path $fallback) { return $fallback }
    return $null
}

function Stop-PidSafe([int]$ProcessId) {
    if ($ProcessId -le 0) { return }
    try {
        $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($null -eq $proc) { return }
        Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
    catch {
        # Ignore races where the process already exited.
    }
}

function Stop-PortListeners([int]$Port) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    }
    catch {
        return
    }
    foreach ($conn in @($conns)) {
        $owningPid = [int]$conn.OwningProcess
        if ($owningPid -gt 0) {
            Write-Step "Stopping PID $owningPid on port $Port"
            Stop-PidSafe $owningPid
        }
    }
}

function Get-ListenerPid([int]$Port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -ne $conn) { return [int]$conn.OwningProcess }
    }
    catch { }
    return 0
}

function Stop-PriorRun {
    if (Test-Path $PidFile) {
        Write-Step "Stopping previous run from .dev-pids.json"
        try {
            $prev = Get-Content -Raw -Path $PidFile | ConvertFrom-Json
            foreach ($name in @("ngrok", "backend", "frontend")) {
                if ($null -ne $prev.$name) {
                    Stop-PidSafe ([int]$prev.$name)
                }
            }
        }
        catch {
            Write-Host "[dev] Could not parse .dev-pids.json; continuing with port cleanup." -ForegroundColor Yellow
        }
        Remove-Item -Force -Path $PidFile -ErrorAction SilentlyContinue
    }

    Stop-PortListeners $BackendPort
    Stop-PortListeners $FrontendPort

    Get-Process -Name "ngrok" -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Step "Stopping ngrok PID $($_.Id)"
        Stop-PidSafe $_.Id
    }

    Start-Sleep -Seconds 1
}

function Assert-Prerequisites {
    if (-not (Get-WindowsTerminal)) {
        Write-Fail "Windows Terminal (wt.exe) not found. Install it from the Microsoft Store."
        exit 1
    }
    $ngrokCmd = Get-Command ngrok -ErrorAction SilentlyContinue
    if (-not $ngrokCmd) {
        Write-Fail "ngrok not found on PATH. Install ngrok and try again."
        exit 1
    }
    if (-not (Test-Path $VenvPython)) {
        Write-Fail "Backend venv missing: $VenvPython"
        Write-Fail "Create it with: cd backend; python -m venv venv; .\venv\Scripts\pip install -e `".[dev]`""
        exit 1
    }
    if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
        Write-Fail "Frontend dependencies missing: $FrontendDir\node_modules"
        Write-Fail "Install with: cd frontend; npm install"
        exit 1
    }
    if (-not (Test-Path $EnvFile)) {
        Write-Fail "Missing backend .env at $EnvFile"
        Write-Fail "Copy from .env.example first."
        exit 1
    }
}

function Update-BackendEnv([string]$PublicOrigin) {
    $origin = $PublicOrigin.TrimEnd("/")
    $updates = @{
        "TELEGRAM_WEBHOOK_BASE_URL" = $origin
        "REGOS_WEBHOOK_URL"         = "$origin/api/v1/regos/webhook"
        "PUBLIC_APP_BASE_URL"       = $origin
        "MINI_APP_LINK"             = "$origin/partner/{public_key}"
    }

    $lines = @(Get-Content -Path $EnvFile)
    $seen = @{}
    $out = foreach ($line in $lines) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') {
            $key = $Matches[1]
            if ($updates.ContainsKey($key)) {
                $seen[$key] = $true
                "$key=$($updates[$key])"
                continue
            }
        }
        $line
    }

    foreach ($key in $updates.Keys) {
        if (-not $seen.ContainsKey($key)) {
            $out += "$key=$($updates[$key])"
        }
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllLines($EnvFile, [string[]]$out, $utf8NoBom)
    Write-Step "Updated backend/.env:"
    Write-Host "         TELEGRAM_WEBHOOK_BASE_URL=$origin"
    Write-Host "         REGOS_WEBHOOK_URL=$origin/api/v1/regos/webhook"
    Write-Host "         PUBLIC_APP_BASE_URL=$origin"
    Write-Host "         MINI_APP_LINK=$origin/partner/{public_key}"
}

function Get-NgrokHttpsUrl {
    $deadline = (Get-Date).AddSeconds($NgrokWaitSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-RestMethod -Uri $NgrokApi -TimeoutSec 2
            foreach ($tunnel in @($resp.tunnels)) {
                $url = [string]$tunnel.public_url
                if ($url -like "https://*") {
                    return $url.TrimEnd("/")
                }
            }
        }
        catch {
            # ngrok API not ready yet
        }
        Start-Sleep -Milliseconds 500
    }
    return $null
}

function Write-RunnerScript([string]$Path, [string]$Body) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($Path, $Body, $utf8NoBom)
}

function Quote-WtArg([string]$Value) {
    # Escape for a single Windows command-line argument.
    if ($Value -notmatch '[ \t"]') {
        return $Value
    }
    return '"' + ($Value.Replace('"', '\"')) + '"'
}

function Start-WtTab {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("new", "last")][string]$Window,
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$RunnerScript
    )

    $wt = Get-WindowsTerminal
    $parts = New-Object System.Collections.Generic.List[string]
    if ($Window -eq "new") {
        [void]$parts.Add("-w")
        [void]$parts.Add("new")
    }
    else {
        [void]$parts.Add("-w")
        [void]$parts.Add("last")
        [void]$parts.Add("new-tab")
    }
    [void]$parts.Add("--title")
    [void]$parts.Add((Quote-WtArg $Title))
    [void]$parts.Add("-d")
    [void]$parts.Add((Quote-WtArg $WorkingDirectory))
    [void]$parts.Add("powershell")
    [void]$parts.Add("-NoExit")
    [void]$parts.Add("-NoProfile")
    [void]$parts.Add("-ExecutionPolicy")
    [void]$parts.Add("Bypass")
    [void]$parts.Add("-File")
    [void]$parts.Add((Quote-WtArg $RunnerScript))

    # One pre-quoted command line avoids Start-Process array splitting
    # (which created extra tabs named "&" / "npm").
    $argLine = [string]::Join(" ", $parts)
    $proc = Start-Process -FilePath $wt -ArgumentList $argLine -PassThru
    return [int]$proc.Id
}

function New-DevRunners {
    if (-not (Test-Path $RunDir)) {
        New-Item -ItemType Directory -Path $RunDir | Out-Null
    }

    $ngrokRunner = Join-Path $RunDir "ngrok.ps1"
    $backendRunner = Join-Path $RunDir "backend.ps1"
    $frontendRunner = Join-Path $RunDir "frontend.ps1"

    Write-RunnerScript $ngrokRunner @"
`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath '$Root'
ngrok http $BackendPort
"@

    Write-RunnerScript $backendRunner @"
`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath '$BackendDir'
& '$VenvPython' -m uvicorn app.main:app --reload --port $BackendPort
"@

    Write-RunnerScript $frontendRunner @"
`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath '$FrontendDir'
npm.cmd run dev -- --port $FrontendPort --strictPort
"@

    return @{
        ngrok    = $ngrokRunner
        backend  = $backendRunner
        frontend = $frontendRunner
    }
}

# --- main ---
Write-Step "Restarting development stack..."
Assert-Prerequisites
Stop-PriorRun

$runners = New-DevRunners

Write-Step "Starting ngrok http $BackendPort (Windows Terminal)"
$null = Start-WtTab -Window new -Title "ngrok :$BackendPort" -WorkingDirectory $Root -RunnerScript $runners.ngrok

Write-Step "Waiting for ngrok public URL..."
$publicUrl = Get-NgrokHttpsUrl
if (-not $publicUrl) {
    Write-Fail "Timed out waiting for ngrok HTTPS URL at $NgrokApi"
    Get-Process -Name "ngrok" -ErrorAction SilentlyContinue | ForEach-Object { Stop-PidSafe $_.Id }
    exit 1
}
Write-Step "ngrok URL: $publicUrl"

Update-BackendEnv $publicUrl

Write-Step "Starting backend (uvicorn :$BackendPort)"
$null = Start-WtTab -Window last -Title "backend :$BackendPort" -WorkingDirectory $BackendDir -RunnerScript $runners.backend

Write-Step "Starting frontend (vite :$FrontendPort)"
$null = Start-WtTab -Window last -Title "frontend :$FrontendPort" -WorkingDirectory $FrontendDir -RunnerScript $runners.frontend

function Wait-ListenerPid([int]$Port, [int]$TimeoutSeconds = 20) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $pidOnPort = Get-ListenerPid $Port
        if ($pidOnPort -gt 0) { return $pidOnPort }
        Start-Sleep -Milliseconds 500
    }
    return 0
}

Write-Step "Waiting for local listeners..."
$backendPid = Wait-ListenerPid $BackendPort
$frontendPid = Wait-ListenerPid $FrontendPort

$ngrokPid = 0
$ngrokProc = Get-Process -Name "ngrok" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ngrokProc) { $ngrokPid = [int]$ngrokProc.Id }

$pidInfo = [ordered]@{
    ngrok     = $ngrokPid
    backend   = $backendPid
    frontend  = $frontendPid
    started   = (Get-Date).ToString("o")
    publicUrl = $publicUrl
}
($pidInfo | ConvertTo-Json) | Set-Content -Path $PidFile -Encoding utf8

Write-Host ""
Write-Step "Dev stack is up in one Windows Terminal window (3 tabs)."
Write-Host "  Backend:  http://localhost:$BackendPort"
Write-Host "  Frontend: http://localhost:$FrontendPort"
Write-Host "  Public:   $publicUrl"
Write-Host "  Re-run this script anytime to stop and restart."
Write-Host ""
