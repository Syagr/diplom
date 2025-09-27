<#
up-dev.ps1

Dev helper for Windows PowerShell:
- validates `apps/api/.env` for common values
- runs `pnpm prisma generate` and `pnpm prisma validate`
- opens three PowerShell windows: API, worker:previews, worker:cleanup
- checks /healthz and prints guidance for smoke tests

Usage: run from PowerShell (may require running as your user that can open new windows):
  .\scripts\up-dev.ps1

#>

Set-StrictMode -Version Latest
Write-Host "Starting dev launcher (up-dev.ps1)" -ForegroundColor Cyan

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..')
$apiPath  = Resolve-Path (Join-Path $repoRoot 'apps\api')

Write-Host "Repo root: $repoRoot" -ForegroundColor DarkCyan
Write-Host "API path:  $apiPath" -ForegroundColor DarkCyan

$envFile = Join-Path $apiPath '.env'
if (-not (Test-Path $envFile)) {
    Write-Warning "Missing $envFile — ensure your .env exists in apps/api. Aborting."
    exit 1
}

$envText = Get-Content $envFile -Raw

function Check-EnvValue($name, $pattern) {
    if ($envText -match $pattern) {
        Write-Host "✓ $name: matched" -ForegroundColor Green
        return $true
    }
    else {
        Write-Warning "✗ $name: not matching expected pattern ($pattern)"
        return $false
    }
}

Write-Host "Validating important .env values..." -ForegroundColor Yellow
Check-EnvValue 'DATABASE_URL contains test:test' 'DATABASE_URL\s*=\s*postgres(?:ql)?://test:test@'
Check-EnvValue 'MINIO_PORT present' 'MINIO_PORT\s*=\s*\d+'
Check-EnvValue 'MINIO_ACCESS_KEY present' 'MINIO_ACCESS_KEY\s*=\s*\S+'
Check-EnvValue 'REDIS host/port' '(REDIS_HOST|REDIS_URL|REDIS_PORT)\s*=\s*'
Check-EnvValue 'JWT_SECRET present' 'JWT_SECRET\s*=\s*\S+'

Write-Host "\nRunning Prisma client generation and validation..." -ForegroundColor Yellow
Push-Location $apiPath
try {
    $gen = pnpm -s prisma generate
    if ($LASTEXITCODE -ne 0) { throw "prisma generate failed" }
    $val = pnpm -s prisma validate
    if ($LASTEXITCODE -ne 0) { throw "prisma validate failed" }
    Write-Host "Prisma generate + validate succeeded" -ForegroundColor Green
}
catch {
    Write-Host "Prisma step failed: $_" -ForegroundColor Red
    Pop-Location
    exit 2
}
Pop-Location

Write-Host "\nStarting API and workers in new PowerShell windows..." -ForegroundColor Yellow

function Start-Window($title, $command) {
    $escaped = $command -replace '"','\"'
    Start-Process -FilePath powershell -ArgumentList "-NoExit","-Command","Write-Host \"$title\" -ForegroundColor Cyan; cd '$apiPath'; $command" -WindowStyle Normal
}

Start-Window 'API (pnpm run dev)' 'pnpm run dev'
Start-Sleep -Milliseconds 500
Start-Window 'Worker - previews' 'pnpm run worker:previews'
Start-Sleep -Milliseconds 300
Start-Window 'Worker - cleanup' 'pnpm run worker:cleanup'

Write-Host "Waiting 6s for services to start..." -ForegroundColor DarkYellow
Start-Sleep -Seconds 6

Write-Host "Checking /healthz..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri 'http://localhost:3000/healthz' -UseBasicParsing -ErrorAction Stop
    Write-Host "Health OK:" (ConvertTo-Json $health -Depth 3) -ForegroundColor Green
}
catch {
    Write-Warning "Health check failed: $_"
    Write-Host "Open API logs in the API window that was started to see errors." -ForegroundColor Yellow
}

Write-Host "\nQuick smoke suggestions:" -ForegroundColor Cyan
Write-Host " - Create test user (bcrypt hash) and insert into DB, or use Prisma Studio." -ForegroundColor DarkCyan
Write-Host " - Use provided curl examples in the project README for /api/auth/login and attachments presign flows." -ForegroundColor DarkCyan

Write-Host "Done. Three windows were opened for API and workers. Use Ctrl+C in them to stop each service." -ForegroundColor Green
